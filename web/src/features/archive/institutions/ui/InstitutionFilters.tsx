import { useEffect, useRef, useState } from 'react';
import type { ArchiveMetadata, InstitutionQuery } from '../../../../domain/institutions/models';
import { ActionButton } from '../../../../components/common/ActionButton';
import { defaultInstitutionQuery, parseInstitutionQuery } from '../query-state';

function FilterFields({
  query,
  metadata,
  onChange,
}: {
  query: InstitutionQuery;
  metadata: ArchiveMetadata | undefined;
  onChange: (query: InstitutionQuery) => void;
}) {
  const fields = [
    { key: 'region', label: '地区', options: metadata?.regions, value: query.region },
    {
      key: 'evidence_status',
      label: '证据状态',
      options: metadata?.evidenceStatuses,
      value: query.evidenceStatus,
    },
    { key: 'risk_tag', label: '信息分类', options: metadata?.riskTags, value: query.riskTag },
    {
      key: 'operating_status',
      label: '运营状态',
      options: metadata?.operatingStatuses,
      value: query.operatingStatus,
    },
  ];
  function change(field: string, value: string) {
    const parsed = parseInstitutionQuery(new URLSearchParams({ [field]: value }));
    if (field === 'region') onChange({ ...query, region: parsed.region });
    if (field === 'evidence_status') onChange({ ...query, evidenceStatus: parsed.evidenceStatus });
    if (field === 'risk_tag') onChange({ ...query, riskTag: parsed.riskTag });
    if (field === 'operating_status')
      onChange({ ...query, operatingStatus: parsed.operatingStatus });
  }
  return (
    <>
      {fields.map((field) => (
        <label className="filter-field" key={field.key}>
          <span>{field.label}</span>
          <select value={field.value} onChange={(event) => change(field.key, event.target.value)}>
            <option value="">全部{field.label}</option>
            {field.options?.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </>
  );
}

export function InstitutionFilters({
  query,
  metadata,
  onChange,
}: {
  query: InstitutionQuery;
  metadata: ArchiveMetadata | undefined;
  onChange: (patch: Partial<InstitutionQuery>) => void;
}) {
  const [mobile, setMobile] = useState(
    () =>
      typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches,
  );
  const [draft, setDraft] = useState(query);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 1023px)');
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  function clear() {
    return {
      ...query,
      region: '',
      riskTag: '' as const,
      evidenceStatus: '' as const,
      operatingStatus: '' as const,
      q: '',
      sort: defaultInstitutionQuery.sort,
    };
  }
  function close() {
    dialog.current?.close();
    trigger.current?.focus();
  }
  if (mobile)
    return (
      <div className="mobile-filter-control">
        <ActionButton
          ref={trigger}
          variant="outline"
          onClick={() => {
            setDraft(query);
            dialog.current?.showModal();
          }}
        >
          筛选公开档案
        </ActionButton>
        <dialog
          ref={dialog}
          className="filter-dialog"
          aria-labelledby="filter-dialog-title"
          onClose={() => trigger.current?.focus()}
        >
          <div className="filter-dialog-heading">
            <h2 id="filter-dialog-title">缩小查询范围</h2>
            <ActionButton variant="outline" onClick={close}>
              取消
            </ActionButton>
          </div>
          <p>修改只在点击“应用筛选”后生效。</p>
          <div className="filters">
            <FilterFields query={draft} metadata={metadata} onChange={setDraft} />
          </div>
          <div className="filter-dialog-actions">
            <ActionButton variant="outline" onClick={() => setDraft(clear())}>
              清除条件
            </ActionButton>
            <ActionButton
              onClick={() => {
                onChange({ ...draft, page: 1 });
                close();
              }}
            >
              应用筛选
            </ActionButton>
          </div>
        </dialog>
      </div>
    );
  return (
    <aside className="filters" aria-label="机构筛选">
      <h2>缩小查询范围</h2>
      <FilterFields
        query={query}
        metadata={metadata}
        onChange={(next) => onChange({ ...next, page: 1 })}
      />
      <ActionButton variant="outline" onClick={() => onChange(clear())}>
        清除搜索与筛选
      </ActionButton>
    </aside>
  );
}
