// Registration metadata only. No content, permissions grants, or server state.
export const archiveManifest = {
  id: 'archive',
  name: '公共档案',
  publicRoutes: ['/', '/archive', '/institutions', '/institutions/:slug'],
  adminRoutes: [],
  apiNamespace: '/api/v1/public',
  capabilities: ['institutions:read', 'sources:read', 'timeline:read'],
  navigation: [
    { label: '首页', href: '/' },
    { label: '机构名录', href: '/institutions' },
  ],
  permissions: ['public:read'],
  featureFlags: { enabled: true, submissions: false },
  queryNamespace: 'archive',
} as const;
