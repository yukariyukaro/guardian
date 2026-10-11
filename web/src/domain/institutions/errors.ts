export type ArchiveErrorKind =
  'not-found' | 'validation' | 'rate-limited' | 'unavailable' | 'network' | 'invalid-response';

export class ArchiveError extends Error {
  constructor(
    public readonly kind: ArchiveErrorKind,
    public readonly requestId?: string,
  ) {
    super(kind);
    this.name = 'ArchiveError';
  }
}
export function safeErrorMessage(error: unknown): string {
  if (error instanceof ArchiveError) {
    switch (error.kind) {
      case 'not-found':
        return '未找到可公开的资源。';
      case 'validation':
        return '查询参数不符合要求，请清除筛选后重试。';
      case 'rate-limited':
        return '请求过于频繁，请稍后重试。';
      case 'invalid-response':
        return '暂时无法确认资料格式，请稍后重试。';
      default:
        return '服务暂时不可用，请稍后重试。';
    }
  }
  return '服务暂时不可用，请稍后重试。';
}
