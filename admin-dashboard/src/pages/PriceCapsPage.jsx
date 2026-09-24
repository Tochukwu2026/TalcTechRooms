import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function PriceCapsPage() {
  const { session } = useAuth();
  const [caps, setCaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [newLocation, setNewLocation] = useState({ state: '', area: '', capNaira: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/admin/price-caps', { token: session.token });
      setCaps(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(id) {
    const value = edits[id];
    if (value === undefined || value === '') return;
    setSavingId(id);
    try {
      await apiFetch(`/admin/price-caps/${id}`, {
        method: 'PATCH',
        token: session.token,
        body: { capNaira: Number(value) },
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingId(null);
    }
  }

  async function createLocation(e) {
    e.preventDefault();
    setCreateError('');
    if (!newLocation.state || !newLocation.capNaira) {
      setCreateError('State and Cap are required.');
      return;
    }
    setCreating(true);
    try {
      await apiFetch('/admin/price-caps', {
        method: 'POST',
        token: session.token,
        body: {
          state: newLocation.state,
          area: newLocation.area || undefined,
          capNaira: Number(newLocation.capNaira),
        },
      });
      setNewLocation({ state: '', area: '', capNaira: '' });
      await load();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h2>Price Caps</h2>
      <p className="page-subtitle">
        Maximum nightly rate a Renter can post at, per location. Posting above this is rejected
        with "You have exceeded the Price Cap for this location."
      </p>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Area</th>
              <th>Cap (₦/night)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {caps.map((c) => {
              const dirty = edits[c.id] !== undefined && Number(edits[c.id]) !== Number(c.cap_naira);
              return (
                <tr key={c.id}>
                  <td>{c.state}</td>
                  <td>{c.area || <span className="muted">— (flat state cap)</span>}</td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={edits[c.id] ?? c.cap_naira}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-primary"
                      disabled={savingId === c.id || !dirty}
                      onClick={() => save(c.id)}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3>Add a new location</h3>
      <form className="inline-form" onSubmit={createLocation}>
        <label>
          State
          <input
            value={newLocation.state}
            onChange={(e) => setNewLocation((prev) => ({ ...prev, state: e.target.value }))}
            placeholder="e.g. Lagos"
          />
        </label>
        <label>
          Area <span className="muted">(Lagos only — leave blank for a flat state cap)</span>
          <input
            value={newLocation.area}
            onChange={(e) => setNewLocation((prev) => ({ ...prev, area: e.target.value }))}
            placeholder="e.g. Badagry"
          />
        </label>
        <label>
          Cap (₦/night)
          <input
            type="number"
            min="1"
            step="1"
            value={newLocation.capNaira}
            onChange={(e) => setNewLocation((prev) => ({ ...prev, capNaira: e.target.value }))}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={creating}>
          {creating ? 'Adding…' : 'Add location'}
        </button>
      </form>
      {createError && <div className="error-banner">{createError}</div>}
    </div>
  );
}
