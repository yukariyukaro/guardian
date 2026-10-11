import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

export function AppShell({ isMock }: { isMock: boolean }) {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    // Fixed public titles: never echo URL/query text or resource identities.
    const title =
      pathname === '/' || pathname === '/archive'
        ? '公共档案首页'
        : pathname === '/institutions'
          ? '机构名录'
          : /^\/institutions\/[^/]+\/?$/.test(pathname)
            ? '机构档案'
            : '页面不可用';
    document.title = `${title} | Guardian 公共档案`;
    main.current?.focus();
  }, [pathname]);
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳至主要内容
      </a>
      <header className="masthead">
        <div className="container masthead-inner">
          <NavLink to="/" className="brand" aria-label="Guardian 公共档案首页">
            <span className="brand-mark" aria-hidden="true">
              G.
            </span>
            <span>
              <strong>GUARDIAN</strong>
              <small>公共档案 / PUBLIC ARCHIVE</small>
            </span>
          </NavLink>
          <nav aria-label="主要导航">
            <NavLink to="/" end>
              首页
            </NavLink>
            <NavLink to="/institutions">机构名录</NavLink>
          </nav>
          <span className="edition">
            ARCHIVE <span aria-hidden="true">/</span> 01
          </span>
        </div>
      </header>
      {isMock && (
        <div className="mock-banner" role="note">
          <div className="container">
            <span className="mock-label">虚构数据演示</span>{' '}
            所有机构、来源和事件均为虚构，仅用于验证界面与调用链。
          </div>
        </div>
      )}
      <main ref={main} id="main-content" className="container" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <strong>GUARDIAN</strong>
            <p>从公开记录开始，让信息能够被核对。</p>
          </div>
          <p>
            资料的收录不等于事实认定或司法结论。
            <br />
            当前仅开放档案查询，不收集投稿或个人身份。
          </p>
          <span className="mono">{isMock ? 'FICTIONAL / PROTOTYPE' : 'PUBLIC / ARCHIVE'}</span>
        </div>
      </footer>
    </>
  );
}
