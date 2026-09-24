import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function SettingsPage() {
  const { session } = useAuth();
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState({});
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/admin/settings', { token: session.token });
      setSettings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(key) {
    const value = edits[key];
    if (value === undefined || value === '') return;
    setSavingKey(key);
    try {
      await apiFetch(`/admin/settings/${key}`, {
        method: 'PATCH',
        token: session.token,
        body: { value: Number(value) },
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div>
      <h2>Business Settings</h2>
      <p className="page-subtitle">
        These drive the Rent + Admin Costs + VAT checkout breakdown and the Renter/TalcTech
        commission split. Changes take effect immediately — nothing is cached.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Setting</th>
              <th>Description</th>
              <th>Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {settings.map((s) => {
              const dirty = edits[s.key] !== undefined && Number(edits[s.key]) !== Number(s.value);
              return (
                <tr key={s.key}>
                  <td>
                    <code>{s.key}</code>
                  </td>
                  <td className="description">{s.description}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={edits[s.key] ?? s.value}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [s.key]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-primary"
                      disabled={savingKey === s.key || !dirty}
                      onClick={() => save(s.key)}
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
    </div>
  );
}
