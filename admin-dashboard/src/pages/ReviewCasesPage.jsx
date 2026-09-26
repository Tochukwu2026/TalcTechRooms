import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const REASON_LABELS = {
  no_show_no_response: 'No check-in confirmation / no report',
  fraud_report: 'Customer reported a problem',
  other: 'Other',
};

// Path A of the Renter Payout flow (see spec/decisions-and-phasing.md > Renter Payout) lands a
// booking here whenever the Customer reports a problem, or the 9pm check-in-day evaluation job
// finds no confirmation and no report. Path B (Customer-initiated cancellation) never enters this
// queue - it resolves itself immediately.
export default function ReviewCasesPage() {
  const { session } = useAuth();
  const [statusFilter, setStatusFilter] = useState('open');
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/admin/review-cases?status=${statusFilter}`, { token: session.token });
      setCases(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session.token, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(caseId, resolution) {
    const label = resolution === 'release_payout' ? 'release the payout to the Renter' : 'refund the Customer';
    if (!window.confirm(`Are you sure you want to ${label} for this case?`)) return;
    const notes = window.prompt('Notes for this resolution (optional):') || undefined;

    setActioningId(caseId);
    try {
      await apiFetch(`/admin/review-cases/${caseId}/resolve`, {
        method: 'PATCH',
        token: session.token,
        body: { resolution, notes },
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
      <h2>Payout Review Cases</h2>
      <p className="page-subtitle">
        A booking lands here when a Customer reports a problem on check-in day, or the 9pm
        evaluation job finds no check-in confirmation and no report. Resolve each case by either
        releasing the held payout to the Renter or refunding the Customer.
      </p>

      <div className="inline-form" style={{ marginBottom: 20 }}>
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="empty-state">No {statusFilter} review cases right now.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Booking</th>
              <th>Check-in</th>
              <th>Reason</th>
              <th>Notes</th>
              <th>Payout Amount</th>
              <th>Payout Status</th>
              <th>Opened</th>
              {statusFilter === 'open' && <th></th>}
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td>#{c.booking_id}</td>
                <td>{c.check_in_date}</td>
                <td>{REASON_LABELS[c.reason] || c.reason}</td>
                <td className="description">{c.notes || '—'}</td>
                <td>₦{Number(c.renter_net_payout_naira).toLocaleString()}</td>
                <td>
                  <span className={`badge badge-${c.payout_status}`}>{c.payout_status.replaceAll('_', ' ')}</span>
                </td>
                <td>{new Date(c.opened_at).toLocaleString()}</td>
                {statusFilter === 'open' && (
                  <td className="actions">
                    <button
                      className="btn-primary"
                      disabled={actioningId === c.id}
                      onClick={() => resolve(c.id, 'release_payout')}
                    >
                      Release Payout
                    </button>
                    <button
                      className="btn-danger"
                      disabled={actioningId === c.id}
                      onClick={() => resolve(c.id, 'refund_customer')}
                    >
                      Refund Customer
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
