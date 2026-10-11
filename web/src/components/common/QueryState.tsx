export function LoadingState({ message = '正在查阅档案…' }: { message?: string }) {
  return (
    <div className="query-state" role="status" aria-live="polite">
      <p>{message}</p>
      <div className="skeleton" aria-hidden="true" />
      <div className="skeleton skeleton-short" aria-hidden="true" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="query-state error-state" role="alert">
      <h2>暂时无法读取档案</h2>
      <p>{message}</p>
      <button type="button" className="button" onClick={onRetry}>
        重新尝试
      </button>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="query-state" role="status">
      <span className="eyebrow">NO MATCHING RECORDS</span>
      <h2>没有匹配的公开档案</h2>
      <p>试试其他名称、别名或地区。未收录不代表不存在风险，也不能据此确认安全。</p>
    </div>
  );
}
