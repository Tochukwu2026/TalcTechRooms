import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ViewingRestrictionsPage() {
  const { session } = useAuth();
  const [states, setStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyState, setBusyState] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStates(await apiFetch('/admin/viewing-restrictions', { token: session.token }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(state, restricted) {
    const question = restricted
      ? `Switch OFF Executive viewings in ${state}? Customers will no longer be able to book viewings for listings there.`
      : `Switch Executive viewings back ON in ${state}?`;
    if (!window.confirm(question)) return;
    setBusyState(state);
    try {
      await apiFetch(`/admin/viewing-restrictions/${encodeURIComponent(state)}`, {
        method: 'PUT',
        token: session.token,
        body: { restricted },
      });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyState(null);
    }
  }

  const restrictedCount = states.filter((s) => s.restricted).length;

  return (
    <div>
      <h2>Executive Viewing Limits</h2>
      <p className="page-subtitle">
        Use this for states where we have no staff on the ground. Restricting a state switches off
        Live and Video Viewings for listings in that state only. Rentals, Regular Customers and
        Executive membership keep working there. Viewings already booked are not cancelled — handle
        those by hand. {restrictedCount} state{restrictedCount === 1 ? '' : 's'} currently restricted.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Executive viewings</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {states.map((s) => (
              <tr key={s.state}>
                <td>{s.state}</td>
                <td>{s.restricted ? <strong>Restricted (off)</strong> : 'Available'}</td>
                <td>
                  <button
                    className={s.restricted ? 'btn-primary' : 'btn-danger'}
                    disabled={busyState === s.state}
                    onClick={() => toggle(s.state, !s.restricted)}
                  >
                    {s.restricted ? 'Lift restriction' : 'Restrict'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
