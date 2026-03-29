import type { HistoryStage } from "@shared/evidenceChainModel";

interface Props {
  stage: HistoryStage | null;
  totalStages: number;
}

export function HistoryDetailPanel({ stage, totalStages }: Props) {
  if (!stage) {
    return (
      <div
        style={{
          padding: "20px 16px",
          fontSize: 13,
          color: "var(--color-text-tertiary)",
          lineHeight: 1.7,
        }}
      >
        Click any node to see how and why it had to exist before the next one was possible.
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 16px", fontSize: 13, lineHeight: 1.7 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--color-text-primary)",
            flexShrink: 0,
          }}
        >
          {stage.constructionOrder}
        </div>
        <div>
          <div style={{ fontWeight: 500, fontSize: 14, color: "var(--color-text-primary)" }}>
            {stage.stageName}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            Built {stage.constructionOrder} of {totalStages}
          </div>
        </div>
      </div>

      <p style={{ color: "var(--color-text-secondary)", marginBottom: 12 }}>{stage.stageRole}</p>

      <div
        style={{
          background: "var(--color-background-secondary)",
          borderRadius: "var(--border-radius-md)",
          padding: "10px 13px",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "var(--color-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: ".06em",
            marginBottom: 5,
          }}
        >
          Why it had to come first
        </div>
        <div style={{ color: "var(--color-text-primary)", fontSize: 13 }}>{stage.whyFirst}</div>
      </div>

      <div
        style={{
          background: "var(--color-background-secondary)",
          borderRadius: "var(--border-radius-md)",
          padding: "10px 13px",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "var(--color-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: ".06em",
            marginBottom: 5,
          }}
        >
          What breaks without it
        </div>
        <div style={{ color: "var(--color-text-primary)", fontSize: 13 }}>{stage.whatBreaksWithout}</div>
      </div>

      <div
        style={{
          borderLeft: "2px solid var(--color-border-secondary)",
          paddingLeft: 12,
          marginTop: 14,
          fontSize: 13,
          color: "var(--color-text-secondary)",
          fontStyle: "italic",
          lineHeight: 1.7,
        }}
      >
        {stage.organismMetaphor}
      </div>
    </div>
  );
}
