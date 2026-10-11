import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="query-state page-section">
      <span className="eyebrow">404 / NOT FOUND</span>
      <h1>未找到可公开的页面</h1>
      <p>页面可能不存在，或资料当前不可公开。</p>
      <Link className="button" to="/institutions">
        返回机构名录
      </Link>
    </section>
  );
}
