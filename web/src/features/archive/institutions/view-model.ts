import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isKnownUnavailable,
  requireVisibleRecords,
  unavailableKey,
} from '../../../app/archive-query-client';
import { useSearchParams } from 'react-router-dom';
import { useArchiveService } from '../../../app/services-context';
import { ArchiveError, safeErrorMessage } from '../../../domain/institutions/errors';
import type { Institution, InstitutionQuery, Source } from '../../../domain/institutions/models';
import {
  evidenceLabels,
  formatDate,
  operatingLabels,
  riskLabels,
} from '../../../domain/institutions/presentation';
import {
  archiveKeys,
  defaultInstitutionQuery,
  parseInstitutionQuery,
  serializeInstitutionQuery,
} from './query-state';

export function toInstitutionView(record: Institution) {
  return {
    ...record,
    href: `/institutions/${record.slug}`,
    evidenceLabel: evidenceLabels[record.evidenceStatus],
    evidenceClass:
      record.evidenceStatus === 'official_record'
        ? 'badge-official'
        : record.evidenceStatus === 'multiple_sources'
          ? 'badge-corroborated'
          : record.evidenceStatus === 'pending_verification'
            ? 'badge-pending'
            : '',
    operatingLabel: operatingLabels[record.operatingStatus],
    riskLabels: record.riskTags.map((tag) => riskLabels[tag]),
    reviewedDate: formatDate(record.reviewedAt),
    updatedDate: formatDate(record.updatedAt),
  };
}
export type InstitutionView = ReturnType<typeof toInstitutionView>;

export function useHomeViewModel() {
  const service = useArchiveService();
  const client = useQueryClient();
  const query = { ...defaultInstitutionQuery, pageSize: 3 };
  const result = useQuery({
    queryKey: archiveKeys.list(query),
    queryFn: async ({ signal }) => {
      const data = await service.list(query, signal);
      requireVisibleRecords(client, data.records);
      return data;
    },
  });
  return {
    ...result,
    records: result.isError ? [] : (result.data?.records.map(toInstitutionView) ?? []),
    total: result.data?.total ?? 0,
    errorMessage: safeErrorMessage(result.error),
  };
}

export function useInstitutionListViewModel() {
  const service = useArchiveService();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const parsed = parseInstitutionQuery(params);
  const metadata = useQuery({
    queryKey: archiveKeys.metadata,
    queryFn: ({ signal }) => service.metadata(signal),
  });
  const query = {
    ...parsed,
    region:
      metadata.data && !metadata.data.regions.some((region) => region.value === parsed.region)
        ? ''
        : parsed.region,
  };
  const canonical = serializeInstitutionQuery(query).toString();
  const current = params.toString();
  useEffect(() => {
    if (current !== canonical) setParams(canonical, { replace: true });
  }, [canonical, current, setParams]);
  const result = useQuery({
    queryKey: archiveKeys.list(query),
    queryFn: async ({ signal }) => {
      const data = await service.list(query, signal);
      requireVisibleRecords(client, data.records);
      return data;
    },
    enabled: metadata.isSuccess,
  });
  function changeQuery(patch: Partial<InstitutionQuery>) {
    setParams(serializeInstitutionQuery({ ...query, page: 1, ...patch }));
  }
  const error = metadata.error ?? result.error;
  return {
    query,
    metadata: metadata.data,
    records: error ? [] : (result.data?.records.map(toInstitutionView) ?? []),
    page: result.data,
    isPending: metadata.isPending || (metadata.isSuccess && result.isPending),
    isFetching: metadata.isFetching || result.isFetching,
    isError: !!error,
    errorMessage: safeErrorMessage(error),
    changeQuery,
    retry: () => {
      void metadata.refetch();
      void result.refetch();
    },
  };
}

export function useInstitutionDetailViewModel(slug: string) {
  const service = useArchiveService();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = (field: string) => {
    const raw = params.get(field);
    const value = raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : 1;
    return Number.isSafeInteger(value) && value <= 1_000_000 ? value : 1;
  };
  const timelinePage = page('timeline_page');
  const sourcesPage = page('sources_page');
  const visibility = useQuery({
    queryKey: unavailableKey(slug),
    queryFn: () => isKnownUnavailable(client, slug),
    enabled: false,
  });
  const blocked = visibility.data === true;
  const dossier = useQuery({
    queryKey: archiveKeys.dossier(slug, timelinePage, sourcesPage),
    queryFn: ({ signal }) =>
      service.dossier(
        slug,
        { page: timelinePage, pageSize: 20 },
        { page: sourcesPage, pageSize: 20 },
        signal,
      ),
    enabled: !blocked,
  });
  function changePage(field: string, value: number) {
    const next = new URLSearchParams(params);
    if (value === 1) next.delete(field);
    else next.set(field, String(value));
    setParams(next);
  }
  const data =
    !blocked && !dossier.isError && !dossier.isFetching && !dossier.isPaused
      ? dossier.data
      : undefined;
  return {
    ...dossier,
    isPending: !blocked && (dossier.isPending || dossier.isFetching || dossier.isPaused),
    record: data ? toInstitutionView(data.institution) : undefined,
    notFound:
      blocked || (dossier.error instanceof ArchiveError && dossier.error.kind === 'not-found'),
    errorMessage: safeErrorMessage(dossier.error),
    changeTimelinePage: (value: number) => changePage('timeline_page', value),
    changeSourcesPage: (value: number) => changePage('sources_page', value),
    timeline: {
      page: data?.timeline,
      records:
        data?.timeline.records.map((event) => ({
          ...event,
          dateLabel: formatDate(event.date),
          evidenceLabel: evidenceLabels[event.evidenceStatus],
          responseLabel:
            event.responseStatus === 'none'
              ? '尚无公开回应，不代表拒绝回应'
              : '已有公开回应；以来源内容为准',
        })) ?? [],
    },
    sources: {
      page: data?.sources,
      records: data?.sources.records.map(toSourceView) ?? [],
    },
  };
}

function toSourceView(source: Source) {
  return {
    ...source,
    publishedDate: formatDate(source.publishedOn),
    evidenceLabel: evidenceLabels[source.evidenceStatus],
    linkLabel:
      source.linkStatus === 'unavailable'
        ? '来源链接失效'
        : source.linkStatus === 'unchecked'
          ? '链接尚未核验'
          : source.linkStatus === 'manual_review'
            ? '链接需人工复核'
            : source.linkStatus === 'redirected'
              ? '链接已重定向'
              : '链接可访问',
    canOpen: source.linkStatus === 'accessible' || source.linkStatus === 'redirected',
  };
}

export function useSourceReferenceViewModel(slug: string, id: string, enabled: boolean) {
  const service = useArchiveService();
  const client = useQueryClient();
  const result = useQuery({
    queryKey: archiveKeys.sourceReference(slug, id),
    queryFn: async ({ signal }) => {
      const source = await service.sourceReference(slug, id, signal);
      if (isKnownUnavailable(client, slug)) throw new ArchiveError('not-found');
      return source;
    },
    enabled,
  });
  return {
    ...result,
    record:
      result.isSuccess && !result.isFetching && !result.isPaused
        ? toSourceView(result.data)
        : undefined,
    errorMessage: safeErrorMessage(result.error),
  };
}
