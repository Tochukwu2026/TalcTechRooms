import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function RenterApprovalsPage() {
  const { session } = useAuth();
  const [renters, setRenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/admin/renters/pending', { token: session.token });
      setRenters(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(userId) {
    setActioningId(userId);
    try {
      await apiFetch(`/admin/renters/${userId}/approve`, { method: 'POST', token: session.token });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setActioningId(null);
    }
  }

  async function reject(userId) {
    const reason = window.prompt('Reason for rejecting this Renter (optional):');
    if (reason === null) return; // cancelled
    setActioningId(userId);
    try {
      await apiFetch(`/admin/renters/${userId}/reject`, {
        method: 'POST',
        token: session.token,
        body: { reason: reason || undefined },
      });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setActioningId(null);
    }
  }

  return (
    <div>
      <h2>Pending Renter Approvals</h2>
      <p className="page-subtitle">
        A Renter can only be approved once their ID verification has passed automatically —
        this is the final manual gate before their account goes live.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : renters.length === 0 ? (
        <p className="empty-state">No pending Renter registrations right now.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Address</th>
              <th>ID Document</th>
              <th>ID Verification</th>
              <th>Submitted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {renters.map((r) => {
              const canApprove = r.id_verification_status === 'verified';
              return (
                <tr key={r.id}>
                  <td>{r.full_name}</td>
                  <td>{r.email}</td>
                  <td>{r.phone}</td>
                  <td>{r.address}</td>
                  <td>{r.document_type ? r.document_type.toUpperCase() : '—'}</td>
                  <td>
                    <span className={`badge badge-${r.id_verification_status || 'none'}`}>
                      {r.id_verification_status || 'none'}
                    </span>
                  </td>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="actions">
                    <button
                      className="btn-primary"
                      disabled={actioningId === r.id || !canApprove}
                      title={!canApprove ? 'ID verification has not passed - cannot approve yet.' : ''}
                      onClick={() => approve(r.id)}
                    >
                      Approve
                    </button>
                    <button
                      className="btn-danger"
                      disabled={actioningId === r.id}
                      onClick={() => reject(r.id)}
                    >
                      Reject
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
