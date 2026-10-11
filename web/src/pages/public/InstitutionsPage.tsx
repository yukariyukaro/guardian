import { SearchForm } from '../../components/common/SearchForm';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/QueryState';
import { ActionButton } from '../../components/common/ActionButton';
import { InstitutionCard } from '../../features/archive/institutions/ui/InstitutionCard';
import { InstitutionFilters } from '../../features/archive/institutions/ui/InstitutionFilters';
import { useInstitutionListViewModel } from '../../features/archive/institutions/view-model';
import { parseInstitutionQuery } from '../../features/archive/institutions/query-state';

export function InstitutionsPage() {
  const vm = useInstitutionListViewModel();
  return (
    <>
      <header className="page-header">
        <span className="eyebrow">ARCHIVE / INSTITUTION INDEX</span>
        <h1>风险机构名录</h1>
        <p>检索可公开档案。名称、别名、证据状态与地区共同帮助核对机构身份；收录不意味着定罪。</p>
      </header>
      <div className="directory-search">
        <SearchForm initialValue={vm.query.q} onSearch={(q) => vm.changeQuery({ q })} />
      </div>
      <div className="directory-layout">
        <InstitutionFilters query={vm.query} metadata={vm.metadata} onChange={vm.changeQuery} />
        <section aria-label="查询结果" aria-busy={vm.isFetching}>
          <div className="result-toolbar">
            <p role="status" aria-live="polite">
              {vm.isFetching
                ? '正在核对公开资料…'
                : vm.isError
                  ? '查询暂时不可用'
                  : `${vm.page?.total ?? 0} 份匹配档案`}
            </p>
            <label>
              <span>排序 </span>
              <select
                value={vm.query.sort}
                onChange={(event) =>
                  vm.changeQuery({
                    sort: parseInstitutionQuery(new URLSearchParams({ sort: event.target.value }))
                      .sort,
                  })
                }
              >
                <option value="updated_desc">最近更新优先</option>
                <option value="updated_asc">最早更新优先</option>
                <option value="name_asc">名称顺序</option>
              </select>
            </label>
            <label>
              <span>每页 </span>
              <select
                value={vm.query.pageSize}
                onChange={(event) => vm.changeQuery({ pageSize: Number(event.target.value) })}
              >
                <option value={3}>3 条</option>
                <option value={20}>20 条</option>
                <option value={50}>50 条</option>
                {![3, 20, 50].includes(vm.query.pageSize) && (
                  <option value={vm.query.pageSize}>{vm.query.pageSize} 条</option>
                )}
              </select>
            </label>
          </div>
          {vm.isPending ? (
            <LoadingState />
          ) : vm.isError ? (
            <ErrorState message={vm.errorMessage} onRetry={vm.retry} />
          ) : vm.records.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="institution-list">
              {vm.records.map((record) => (
                <InstitutionCard record={record} key={record.slug} />
              ))}
            </div>
          )}
          {vm.page && !vm.isError && vm.page.totalPages > 0 && (
            <nav className="pagination" aria-label="结果分页">
              <ActionButton
                variant="outline"
                disabled={vm.query.page <= 1 || vm.isFetching}
                onClick={() => vm.changeQuery({ page: vm.query.page - 1 })}
              >
                上一页
              </ActionButton>
              <span>
                第 {vm.query.page} 页 / 共 {vm.page.totalPages} 页
              </span>
              <ActionButton
                variant="outline"
                disabled={vm.query.page >= vm.page.totalPages || vm.isFetching}
                onClick={() => vm.changeQuery({ page: vm.query.page + 1 })}
              >
                下一页
              </ActionButton>
            </nav>
          )}
          <aside className="scope-notice">
            <p>
              没有匹配结果，仅意味着本次查询没有找到公开档案；不能据此推断不存在风险。筛选、排序和分页保存在
              URL 中。
            </p>
          </aside>
        </section>
      </div>
    </>
  );
}
