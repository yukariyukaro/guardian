export const archiveManifest = Object.freeze({
  id: 'archive',
  displayName: 'Public archives',
  publicRoutes: ['/institutions', '/institutions/:slug', '/sources', '/sources/:id'],
  adminRoutes: [],
  apiNamespace: '/api/v1/public',
  capabilities: ['institutions:read', 'sources:read', 'timeline:read', 'metadata:read'],
  navigation: [],
  permissions: { public: 'read-only', admin: 'disabled', internal: 'disabled' },
  featureFlags: { institutions: true, submissions: false, uploads: false, automaticPublishing: false },
});
