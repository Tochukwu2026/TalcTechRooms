import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Layout() {
  const { session, logout } = useAuth();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          TalcTech Rooms
          <span>Admin</span>
        </div>
        <nav>
          <NavLink to="/renters" className={({ isActive }) => (isActive ? 'active' : '')}>
            Renter Approvals
          </NavLink>
          <NavLink to="/price-caps" className={({ isActive }) => (isActive ? 'active' : '')}>
            Price Caps
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            Business Settings
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="user">{session.user.fullName}</div>
          <button className="btn-link" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
