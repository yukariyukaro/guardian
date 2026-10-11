import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActionButton } from '../../components/common/ActionButton';
import type { PageResult } from '../../domain/institutions/models';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/QueryState';
import {
  useInstitutionDetailViewModel,
  useSourceReferenceViewModel,
} from '../../features/archive/institutions/view-model';
import { NotFoundPage } from '../errors/NotFoundPage';

export function InstitutionDetailPage() {
  const { slug = '' } = useParams();
  const vm = useInstitutionDetailViewModel(slug);
  const timelineHeading = useRef<HTMLHeadingElement>(null);
  const sourcesHeading = useRef<HTMLHeadingElement>(null);
  const paginationFocus = useRef<RefObject<HTMLHeadingElement | null> | null>(null);
  useEffect(() => {
    if (!vm.isPending && !vm.notFound && !vm.isError && paginationFocus.current) {
      paginationFocus.current.current?.focus();
      paginationFocus.current = null;
    }
  }, [vm.isPending, vm.notFound, vm.isError]);
  if (vm.notFound) return <NotFoundPage />;
  if (vm.isPaused)
    return (
      <div className="page-section">
        <ErrorState
          message="网络连接不可用，暂时无法核对公开资料；不会显示缓存内容。"
          onRetry={() => {
            void vm.refetch();
          }}
        />
      </div>
    );
  if (vm.isPending)
    return (
      <div className="page-section">
        <LoadingState />
      </div>
    );
  if (vm.isError)
    return (
      <div className="page-section">
        <ErrorState
          message={vm.errorMessage}
          onRetry={() => {
            void vm.refetch();
          }}
        />
      </div>
    );
  const record = vm.record;
  if (!record) return <NotFoundPage />;
  return (
    <>
      <header className="page-header">
        <nav className="breadcrumbs" aria-label="面包屑">
          <Link to="/">首页</Link>
          <span aria-hidden="true">/</span>
          <Link to="/institutions">机构名录</Link>
          <span aria-hidden="true">/</span>
          <span>机构档案</span>
        </nav>
        <span className="eyebrow">PUBLIC DOSSIER / {record.slug}</span>
        <h1>{record.name}</h1>
        <p>{record.summary}</p>
      </header>
      <div className="detail-layout">
        <div>
          <section className="detail-panel" aria-labelledby="timeline-title">
            <span className="eyebrow">01 / CHRONOLOGY</span>
            <h2 id="timeline-title" ref={timelineHeading} tabIndex={-1}>
              公开事件时间线
            </h2>
            {vm.timeline.records.length === 0 ? (
              <EmptyState />
            ) : (
              <ol className="timeline">
                {vm.timeline.records.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.date ?? undefined}>{event.dateLabel}</time>
                    {event.endDate && <span> 至 {event.endDate}</span>}
                    <h3>{event.title}</h3>
                    <span className="badge">{event.evidenceLabel}</span>
                    <p>{event.summary}</p>
                    <p className="institution-summary">{event.responseLabel}</p>
                    {event.sourceIds.map((id) =>
                      vm.sources.records.some((source) => source.id === id) ? (
                        <a key={id} href={`#${id}`} className="mono">
                          来源 · {id}
                        </a>
                      ) : (
                        <SourceReference key={id} slug={slug} id={id} />
                      ),
                    )}
                  </li>
                ))}
              </ol>
            )}
            <RelatedPagination
              label="时间线分页"
              page={vm.timeline.page}
              onChange={(page) => {
                paginationFocus.current = timelineHeading;
                vm.changeTimelinePage(page);
              }}
            />
          </section>
          <section className="detail-panel" aria-labelledby="sources-title">
            <span className="eyebrow">02 / SOURCE REGISTER</span>
            <h2 id="sources-title" ref={sourcesHeading} tabIndex={-1}>
              公开来源索引
            </h2>
            {vm.sources.records.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="source-list">
                {vm.sources.records.map((source) => (
                  <li id={source.id} key={source.id}>
                    <strong>{source.title}</strong>
                    <p>
                      {source.publisher} · {source.publishedDate} · {source.evidenceLabel}
                    </p>
                    <p>{source.summary}</p>
                    <span className="badge">{source.linkLabel}</span>
                    {source.canOpen && (
                      <p>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          查看原始来源（离开本站）
                        </a>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <RelatedPagination
              label="来源分页"
              page={vm.sources.page}
              onChange={(page) => {
                paginationFocus.current = sourcesHeading;
                vm.changeSourcesPage(page);
              }}
            />
          </section>
        </div>
        <aside>
          <section className="detail-panel" aria-labelledby="identity-title">
            <span className="eyebrow">DOSSIER / IDENTITY</span>
            <h2 id="identity-title">身份与资料范围</h2>
            <dl className="detail-metadata">
              <div>
                <dt>粗粒度地区</dt>
                <dd>{record.regionName}</dd>
              </div>
              <div>
                <dt>已记录别名</dt>
                <dd>{record.aliases.length ? record.aliases.join('、') : '暂无已记录别名'}</dd>
              </div>
              <div>
                <dt>证据状态</dt>
                <dd>
                  <span className={`badge ${record.evidenceClass}`}>{record.evidenceLabel}</span>
                </dd>
              </div>
              <div>
                <dt>运营状态</dt>
                <dd>{record.operatingLabel}</dd>
              </div>
              <div>
                <dt>信息分类（不是定罪标签）</dt>
                <dd>{record.riskLabels.length ? record.riskLabels.join('、') : '暂无分类'}</dd>
              </div>
              <div>
                <dt>公开来源数</dt>
                <dd>{record.sourceCount}</dd>
              </div>
              <div>
                <dt>最近人工复核</dt>
                <dd className="mono">{record.reviewedDate}</dd>
              </div>
              <div>
                <dt>公开资料更新</dt>
                <dd className="mono">{record.updatedDate}</dd>
              </div>
            </dl>
          </section>
          <aside className="scope-notice">
            <p>
              本页不包含内部审核信息、精确地址或个人身份。资料收录不构成事实认定；更正、回应与隐私举报功能尚未开放。
            </p>
          </aside>
          <Link to="/institutions">
            返回机构名录 <span aria-hidden="true">→</span>
          </Link>
        </aside>
      </div>
    </>
  );
}

function RelatedPagination({
  label,
  page,
  onChange,
}: {
  label: string;
  page: PageResult<unknown> | undefined;
  onChange: (page: number) => void;
}) {
  if (!page || page.totalPages === 0) return null;
  return (
    <nav className="pagination" aria-label={label}>
      <ActionButton
        variant="outline"
        disabled={page.page <= 1}
        onClick={() => onChange(page.page - 1)}
      >
        上一页
      </ActionButton>
      <span>
        第 {page.page} 页 / 共 {page.totalPages} 页
      </span>
      <ActionButton
        variant="outline"
        disabled={page.page >= page.totalPages}
        onClick={() => onChange(page.page + 1)}
      >
        下一页
      </ActionButton>
    </nav>
  );
}

function SourceReference({ slug, id }: { slug: string; id: string }) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const vm = useSourceReferenceViewModel(slug, id, expanded);
  return (
    <div>
      <ActionButton
        variant="outline"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '收起' : '查阅'}来源 · {id}（其他页）
      </ActionButton>
      {expanded && (
        <div id={panelId}>
          {vm.isPending || vm.isFetching ? (
            <LoadingState />
          ) : vm.isError ? (
            <ErrorState
              message={vm.errorMessage}
              onRetry={() => {
                void vm.refetch();
              }}
            />
          ) : vm.record ? (
            <div>
              <h4>{vm.record.title}</h4>
              <p>
                {vm.record.publisher} · {vm.record.publishedDate} · {vm.record.evidenceLabel}
              </p>
              <p>{vm.record.summary}</p>
              <p>{vm.record.linkLabel}</p>
              {vm.record.canOpen && (
                <a href={vm.record.url} target="_blank" rel="noopener noreferrer">
                  查看原始来源（离开本站）
                </a>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
