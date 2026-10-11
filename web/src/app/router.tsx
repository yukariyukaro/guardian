import { Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { HomePage } from '../pages/public/HomePage';
import { InstitutionsPage } from '../pages/public/InstitutionsPage';
import { InstitutionDetailPage } from '../pages/public/InstitutionDetailPage';
import { NotFoundPage } from '../pages/errors/NotFoundPage';
import { archiveManifest } from './module-manifest';

export function AppRoutes({ isMock }: { isMock: boolean }) {
  return (
    <Routes>
      <Route element={<AppShell isMock={isMock} />}>
        {archiveManifest.featureFlags.enabled && (
          <>
            <Route index element={<HomePage />} />
            <Route path="archive" element={<HomePage />} />
            <Route path="institutions" element={<InstitutionsPage />} />
            <Route path="institutions/:slug" element={<InstitutionDetailPage />} />
          </>
        )}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
