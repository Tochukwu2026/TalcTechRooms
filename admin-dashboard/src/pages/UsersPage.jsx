import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Account deactivation/reactivation - Admin-only, reversible. See backend
// adminService.js and spec/decisions-and-phasing.md > Build Phasing for the founder's
// decisions: deactivating blocks login immediately and cuts off any already-signed-in
// session on its next request, but every row the account owns (bookings, listings,
// payout/viewing history) stays intact, and the email stays reserved to the account
// rather than being freed for a new signup - so reactivating is a true undo.
export default function UsersPage() {
  const { session } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set('role', roleFilter);
      if (search.trim()) params.set('search', search.trim());
      const query = params.toString();
      const data = await apiFetch(`/admin/users${query ? `?${query}` : ''}`, { token: session.token });
      setUsers(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session.token, roleFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  async function deactivate(user) {
    if (
      !window.confirm(
        `Deactivate ${user.full_name} (${user.email})? They won't be able to log in, and any app they're currently signed into will be signed out on their next action. This can be undone.`
      )
    ) {
      return;
    }
    setActioningId(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}/deactivate`, { method: 'PATCH', token: session.token });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setActioningId(null);
    }
  }

  async function reactivate(user) {
    setActioningId(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}/reactivate`, { method: 'PATCH', token: session.token });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setActioningId(null);
    }
  }

  return (
    <div>
      <h2>User Accounts</h2>
      <p className="page-subtitle">
        Deactivating an account is reversible - it blocks login and signs the account out
        immediately, but keeps all of its bookings, listings and history intact, and keeps its
        email reserved to it. Reactivate at any time to undo.
      </p>

      <div className="filters-row" style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          <option value="customer">Customer</option>
          <option value="renter">Renter</option>
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
        <input
          type="text"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="empty-state">No accounts match.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.phone || '—'}</td>
                <td>
                  <span className={`badge badge-${u.is_active ? 'verified' : 'deactivated'}`}>
                    {u.is_active ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="actions">
                  {u.is_active ? (
                    <button
                      className="btn-danger"
                      disabled={actioningId === u.id || u.id === session.user.id}
                      title={u.id === session.user.id ? 'You cannot deactivate your own account.' : ''}
                      onClick={() => deactivate(u)}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button className="btn-primary" disabled={actioningId === u.id} onClick={() => reactivate(u)}>
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
