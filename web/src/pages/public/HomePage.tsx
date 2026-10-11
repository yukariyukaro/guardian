import { Link, useNavigate } from 'react-router-dom';
import { SearchForm } from '../../components/common/SearchForm';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/QueryState';
import { useHomeViewModel } from '../../features/archive/institutions/view-model';
import { InstitutionCard } from '../../features/archive/institutions/ui/InstitutionCard';

export function HomePage() {
  const vm = useHomeViewModel();
  const navigate = useNavigate();
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <span className="eyebrow">GUARDIAN / PUBLIC INTEREST RECORDS</span>
          <h1 id="home-title">
            从公开记录开始，<span>理解机构风险。</span>
          </h1>
          <p className="hero-description">
            整理有来源、可核对的公共档案。区分事实与陈述，保留资料的边界，不替法院作出结论。
          </p>
          <SearchForm
            initialValue=""
            onSearch={(q) => {
              void navigate({
                pathname: '/institutions',
                search: q ? `?${new URLSearchParams({ q })}` : '',
              });
            }}
          />
          <div className="hero-links">
            <Link to="/institutions">
              浏览机构名录 <span aria-hidden="true">→</span>
            </Link>
            <a href="#reading-guide">如何阅读档案</a>
          </div>
        </div>
        <aside className="dossier-preview" aria-label="档案结构示意，不是机构资料">
          <span className="eyebrow">DOSSIER / 阅读之前</span>
          <p className="dossier-title">一份档案，四个核对点。</p>
          <dl>
            <div>
              <dt>01 · 身份</dt>
              <dd>名称、别名与粗粒度地区</dd>
            </div>
            <div>
              <dt>02 · 事件</dt>
              <dd>日期、陈述与证据状态</dd>
            </div>
            <div>
              <dt>03 · 来源</dt>
              <dd>公开记录与资料局限</dd>
            </div>
            <div>
              <dt>04 · 回应</dt>
              <dd>回应、更正与复核日期</dd>
            </div>
          </dl>
          <p className="dossier-footnote">
            证据状态不是危险分数。
            <br />
            未收录，也不代表不存在风险。
          </p>
        </aside>
      </section>
      <div className="trust-strip" aria-label="资料范围">
        <div>
          <strong>{vm.isSuccess ? `${vm.total} 份当前档案` : '公开档案索引'}</strong>
          <span>只展示接口允许公开的资料</span>
        </div>
        <div>
          <strong>来源与日期并列</strong>
          <span>事件日期、资料日期与复核日期分别记录</span>
        </div>
        <div>
          <strong>保留不确定性</strong>
          <span>分类标签不是事实认定或司法结论</span>
        </div>
      </div>
      <section className="page-section" aria-labelledby="recent-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">01 / RECENTLY UPDATED</span>
            <h2 id="recent-title">最近更新的档案</h2>
          </div>
          <Link to="/institutions">
            查阅全部名录 <span aria-hidden="true">→</span>
          </Link>
        </div>
        {vm.isPending ? (
          <LoadingState />
        ) : vm.isError ? (
          <ErrorState
            message={vm.errorMessage}
            onRetry={() => {
              void vm.refetch();
            }}
          />
        ) : vm.records.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="institution-list">
            {vm.records.map((record) => (
              <InstitutionCard key={record.slug} record={record} />
            ))}
          </div>
        )}
        <aside className="scope-notice">
          <p>
            当前切片仅提供机构查询与档案阅读。来源库、投稿和更正处理尚未开放，不提供真实投诉或救援服务。
          </p>
        </aside>
      </section>
      <section id="reading-guide" className="reading-guide" aria-labelledby="reading-title">
        <span className="eyebrow">02 / A READER'S GUIDE</span>
        <h2 id="reading-title">让每一步判断，都回到资料。</h2>
        <div className="guide-grid">
          {[
            { title: '先核对身份', description: '结合名称、别名和地区，避免把同名机构混为一谈。' },
            { title: '再理解事件', description: '区分发生日期与报道日期，保留尚未核实的部分。' },
            { title: '回到原始来源', description: '来源支持什么、不能支持什么，同样重要。' },
            { title: '留意后续回应', description: '查看复核日期；尚无公开回应不意味着承认。' },
          ].map((step, index) => (
            <div className="guide-step" key={step.title}>
              <span className="mono">0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
