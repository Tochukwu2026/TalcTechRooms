import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Live/Video Viewing staff assignment queue - see spec/decisions-and-phasing.md > Platform &
// Stack > Admin Portal / Staff access. The booking + quota logic itself is Customer-facing
// (viewingService); this page is only the Admin side: see who needs a staff member assigned.
export default function ViewingsPage() {
  const { session } = useAuth();
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [viewings, setViewings] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [viewingsData, staffData] = await Promise.all([
        apiFetch(`/admin/viewings${unassignedOnly ? '?unassignedOnly=true' : ''}`, { token: session.token }),
        apiFetch('/admin/staff', { token: session.token }),
      ]);
      setViewings(viewingsData);
      setStaff(staffData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session.token, unassignedOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(viewingId) {
    const staffUserId = selectedStaffId[viewingId];
    if (!staffUserId) {
      alert('Pick a staff member first.');
      return;
    }
    setActioningId(viewingId);
    try {
      await apiFetch(`/admin/viewings/${viewingId}/assign`, {
        method: 'PATCH',
        token: session.token,
        body: { staffUserId },
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
      <h2>Viewing Staff Assignment</h2>
      <p className="page-subtitle">
        Live and Video Viewings booked by Executive Customers land here. Assign a staff member to
        each one so they can carry it out and mark it complete.
      </p>

      <div className="inline-form" style={{ marginBottom: 20 }}>
        <label>
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => setUnassignedOnly(e.target.checked)}
            style={{ width: 'auto', marginRight: 6 }}
          />
          Unassigned only
        </label>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : viewings.length === 0 ? (
        <p className="empty-state">No {unassignedOnly ? 'unassigned' : ''} viewings right now.</p>
      ) : staff.length === 0 ? (
        <p className="empty-state">
          No staff accounts exist yet - create one with the backend's <code>create-staff</code> script
          before you can assign viewings.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Listing</th>
              <th>Type</th>
              <th>Scheduled Date</th>
              <th>Status</th>
              <th>Assigned Staff</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {viewings.map((v) => {
              const currentStaff = staff.find((s) => String(s.id) === String(v.assignedStaffUserId));
              return (
                <tr key={v.id}>
                  <td>
                    {v.accommodationLocationText}
                    <div className="description">{v.accommodationType.replaceAll('_', ' ')}</div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{v.viewingType}</td>
                  <td>{v.scheduledDate}</td>
                  <td>
                    <span className={`badge badge-${v.status}`}>{v.status}</span>
                  </td>
                  <td>{currentStaff ? currentStaff.full_name : '—'}</td>
                  <td className="actions">
                    {v.status === 'scheduled' && (
                      <>
                        <select
                          value={selectedStaffId[v.id] || ''}
                          onChange={(e) => setSelectedStaffId((prev) => ({ ...prev, [v.id]: e.target.value }))}
                        >
                          <option value="">Choose staff…</option>
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.full_name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-primary"
                          disabled={actioningId === v.id}
                          onClick={() => assign(v.id)}
                        >
                          Assign
                        </button>
                      </>
                    )}
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
