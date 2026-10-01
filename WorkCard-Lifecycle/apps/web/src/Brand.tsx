export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? ' brand--compact' : ''}`}>
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand__copy">
        <strong>Рабочие карточки</strong>
        <span>Производственный цикл</span>
      </span>
    </div>
  );
}
