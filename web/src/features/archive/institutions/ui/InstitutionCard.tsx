import { Link } from 'react-router-dom';
import type { InstitutionView } from '../view-model';

export function InstitutionCard({ record }: { record: InstitutionView }) {
  return (
    <article className="institution-card">
      <div>
        <span className="eyebrow">{record.regionName}</span>
        <h3>
          <Link to={record.href}>{record.name}</Link>
        </h3>
        <p className="institution-summary">{record.summary}</p>
        <div className="institution-meta">
          <span>{record.operatingLabel}</span>
          {record.riskLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
          <span>{record.sourceCount} 条公开来源</span>
        </div>
      </div>
      <div className="institution-side">
        <span className={`badge ${record.evidenceClass}`}>{record.evidenceLabel}</span>
        <p>
          最近人工复核
          <br />
          <span className="mono">{record.reviewedDate}</span>
        </p>
        <Link to={record.href} aria-label={`查阅${record.name}的档案`}>
          查阅档案 <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </article>
  );
}
