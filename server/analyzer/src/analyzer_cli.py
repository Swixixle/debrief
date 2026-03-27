import typer
import os
import json
import asyncio
from typing import Optional
from enum import Enum

from .analyzer import Analyzer
from .pta_diff import diff_packs, save_diff
from .core.adapter import load_evidence_pack
from .core.render import render_report, save_report

app = typer.Typer(
    help="Program Totality Analyzer - Generate static-artifact-anchored technical dossiers for software projects.",
    add_completion=False,
)


class RenderMode(str, Enum):
    engineer = "engineer"
    auditor = "auditor"
    executive = "executive"
    plain = "plain"


class ReportAudience(str, Enum):
    pro = "pro"
    learner = "learner"


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context):
    """Program Totality Analyzer CLI."""
    if ctx.invoked_subcommand is None:
        typer.echo(ctx.get_help())
        raise typer.Exit(0)


@app.command("analyze")
def analyze(
    target: Optional[str] = typer.Argument(None, help="GitHub URL or local path to analyze"),
    output_dir: str = typer.Option(..., "--output-dir", "-o", help="Directory to write output files"),
    replit: bool = typer.Option(False, "--replit", help="Analyze current Replit workspace"),
    root: Optional[str] = typer.Option(None, "--root", help="Subdirectory within target to scope analysis"),
    no_llm: bool = typer.Option(False, "--no-llm", help="Deterministic mode: skip LLM calls, produce only profiler/indexer outputs"),
    report_audience: ReportAudience = typer.Option(
        ReportAudience.pro,
        "--mode",
        "-m",
        help='Output audience: "pro" (technical artifacts, default) or "learner" (also writes LEARNER_REPORT.md)',
    ),
    mode: RenderMode = typer.Option(RenderMode.engineer, "--render-mode", help="Report rendering mode: engineer, auditor, executive, or plain (one-pager audience mode)"),
    include_history: bool = typer.Option(False, "--include-history", help="Embed git hotspots into dossier"),
    history_since: str = typer.Option("90d", "--history-since", help="Git history window, e.g. 90d or YYYY-MM-DD"),
    history_top: int = typer.Option(15, "--history-top", help="Number of hotspots to embed"),
    history_include: Optional[str] = typer.Option(None, "--history-include", help="Comma-separated globs to include"),
    history_exclude: Optional[str] = typer.Option(None, "--history-exclude", help="Comma-separated globs to exclude"),
    demo: bool = typer.Option(False, "--demo", help="Generate demo mode outputs (DEMO_DOSSIER.md, DEMO_SUMMARY.json)"),
    model: str = typer.Option("gpt-4.1", "--model", "-M", help="OpenAI chat model id (e.g. gpt-4.1-mini)"),
):
    """
    Analyze a software project and generate a dossier.

    Supports three modes:
    - GitHub repo: analyze https://github.com/user/repo -o ./out
    - Local folder: analyze ./some-folder -o ./out
    - Replit workspace: analyze --replit -o ./out

    Use --no-llm for deterministic extraction without LLM dependency.
    Use --render-mode to select report rendering: engineer (default), auditor, executive, or plain (one-pager).
    Use --model to override the default OpenAI model for all LLM steps.
    """
    console = Analyzer.get_console()

    if replit:
        input_mode = "replit"
        source = os.getcwd()
        console.print(f"[bold green]Replit mode:[/bold green] Analyzing current workspace at {source}")
    elif target and (target.startswith("http://") or target.startswith("https://") or target.startswith("git@")):
        input_mode = "github"
        source = target
        console.print(f"[bold green]GitHub mode:[/bold green] Analyzing {source}")
    elif target and os.path.isdir(target):
        input_mode = "local"
        source = os.path.abspath(target)
        console.print(f"[bold green]Local mode:[/bold green] Analyzing {source}")
    else:
        console.print("[bold red]Error:[/bold red] Provide a GitHub URL, local path, or use --replit")
        raise typer.Exit(code=1)

    if no_llm:
        console.print("[bold yellow]--no-llm mode:[/bold yellow] Skipping LLM calls, deterministic outputs only")
    else:
        console.print(f"[bold cyan]LLM model:[/bold cyan] {model}")

    console.print(f"[bold cyan]Render mode:[/bold cyan] {mode.value}")
    console.print(f"[bold cyan]Report audience:[/bold cyan] {report_audience.value}")

    try:
        analyzer = Analyzer(
            source,
            output_dir,
            mode=input_mode,
            root=root,
            no_llm=no_llm,
            render_mode=mode.value,
            llm_model=model,
            report_audience=report_audience.value,
        )
        asyncio.run(analyzer.run(
            include_history=include_history,
            history_since=history_since,
            history_top=history_top,
            history_include=history_include,
            history_exclude=history_exclude,
            demo=demo,
        ))
        console.print(f"[bold green]Analysis complete![/bold green] Results in {output_dir}")
    except Exception as e:
        console.print(f"[bold red]Error during analysis:[/bold red] {str(e)}")
        import traceback
        traceback.print_exc()
        raise typer.Exit(code=1)


@app.command("diff")
def diff(
    pack_a: str = typer.Argument(..., help="Path to first evidence_pack.v1.json"),
    pack_b: str = typer.Argument(..., help="Path to second evidence_pack.v1.json"),
    output_dir: str = typer.Option(".", "--output-dir", "-o", help="Directory to write diff output files"),
):
    """
    Compare two EvidencePack v1 files and produce a deterministic diff.

    Outputs:
    - diff.json (machine-readable)
    - DIFF_REPORT.md (human-readable)

    Example:
        pta diff out/run1/evidence_pack.v1.json out/run2/evidence_pack.v1.json -o ./diff_out
    """
    console = Analyzer.get_console()

    from pathlib import Path

    path_a = Path(pack_a)
    path_b = Path(pack_b)
    out = Path(output_dir)

    if not path_a.exists():
        console.print(f"[bold red]Error:[/bold red] Pack A not found: {pack_a}")
        raise typer.Exit(code=1)
    if not path_b.exists():
        console.print(f"[bold red]Error:[/bold red] Pack B not found: {pack_b}")
        raise typer.Exit(code=1)

    out.mkdir(parents=True, exist_ok=True)

    console.print(f"[bold]Loading packs...[/bold]")
    a = load_evidence_pack(path_a)
    b = load_evidence_pack(path_b)

    console.print(f"[bold]Computing diff...[/bold]")
    result = diff_packs(a, b)

    diff_json_path, diff_report_path = save_diff(result, out)
    console.print(f"[bold green]Diff complete![/bold green]")
    console.print(f"  diff.json: {diff_json_path}")
    console.print(f"  DIFF_REPORT.md: {diff_report_path}")

    dci = result.get("dci_delta", {})
    rci = result.get("rci_delta", {})
    console.print(f"  DCI_v1_claim_visibility: {dci.get('old_score', 0):.2%} -> {dci.get('new_score', 0):.2%} ({dci.get('direction', '?')})")
    console.print(f"  RCI_reporting_completeness: {rci.get('old_score', 0):.2%} -> {rci.get('new_score', 0):.2%} ({rci.get('direction', '?')})")


@app.command("render")
def render(
    pack_path: str = typer.Argument(..., help="Path to evidence_pack.v1.json"),
    output_dir: str = typer.Option(".", "--output-dir", "-o", help="Directory to write rendered report"),
    mode: RenderMode = typer.Option(RenderMode.engineer, "--mode", help="Report rendering mode"),
):
    """
    Re-render a report from an existing EvidencePack without re-running analysis.

    Example:
        pta render out/evidence_pack.v1.json --mode auditor -o ./reports
    """
    console = Analyzer.get_console()
    from pathlib import Path

    path = Path(pack_path)
    out = Path(output_dir)

    if not path.exists():
        console.print(f"[bold red]Error:[/bold red] Pack not found: {pack_path}")
        raise typer.Exit(code=1)

    out.mkdir(parents=True, exist_ok=True)

    pack = load_evidence_pack(path)
    content = render_report(pack, mode=mode.value)
    report_path = save_report(content, out, mode.value)
    console.print(f"[bold green]Report rendered![/bold green] {report_path}")


if __name__ == "__main__":
    app()
