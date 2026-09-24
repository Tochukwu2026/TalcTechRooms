const { pool, withTransaction } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');
const storage = require('../storage');
const availability = require('../booking/availabilityService');

/**
 * Looks up the price_cap_id for a given {state, area}. area is required for Lagos and must
 * be omitted (or null) for every other supported state - matching the seed data in
 * src/db/seeds/001_price_caps.sql, where non-Lagos rows have area = NULL.
 *
 * Returning a clear 400 here is what actually blocks "unsupported Lagos area" listings (e.g.
 * Ikorodu) - there's simply no price_caps row for them to reference, per
 * spec/decisions-and-phasing.md > Price Cap.
 */
async function findPriceCapId(client, { state, area }) {
  const normalizedArea = area || null;
  const { rows } = await client.query(
    'SELECT id, cap_naira FROM price_caps WHERE state = $1 AND area IS NOT DISTINCT FROM $2',
    [state, normalizedArea]
  );
  if (rows.length === 0) {
    throw new ApiError(
      400,
      normalizedArea
        ? `"${area}" is not a supported area of ${state} yet.`
        : `"${state}" is not a currently supported location.`
    );
  }
  return rows[0].id;
}

async function assertRenterIsApproved(client, renterUserId) {
  const { rows } = await client.query(
    'SELECT approval_status FROM renters WHERE user_id = $1',
    [renterUserId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Renter account not found.');
  }
  if (rows[0].approval_status !== 'approved') {
    throw new ApiError(
      403,
      'Your Renter account must be approved by Admin before you can post an Accommodation.'
    );
  }
}

async function assertOwnsAccommodation(client, accommodationId, renterUserId) {
  const { rows } = await client.query(
    'SELECT id FROM accommodations WHERE id = $1 AND renter_user_id = $2',
    [accommodationId, renterUserId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Accommodation not found.');
  }
}

const LISTING_COLUMNS = `
  a.id, a.renter_user_id, a.type, a.location_text, a.description, a.contact_info,
  a.number_of_units, a.units_available, a.nightly_rent_naira, a.is_active,
  a.created_at, a.updated_at,
  pc.state, pc.area, pc.cap_naira AS price_cap_naira
`;

async function createAccommodation(renterUserId, input) {
  return withTransaction(async (client) => {
    await assertRenterIsApproved(client, renterUserId);
    const priceCapId = await findPriceCapId(client, { state: input.state, area: input.area });

    const { rows } = await client.query(
      `INSERT INTO accommodations
         (renter_user_id, type, price_cap_id, location_text, description, contact_info,
          number_of_units, units_available, nightly_rent_naira)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
       RETURNING id`,
      [
        renterUserId,
        input.type,
        priceCapId,
        input.locationText,
        input.description,
        input.contactInfo,
        input.numberOfUnits,
        input.nightlyRentNaira,
      ]
    );
    const accommodationId = rows[0].id;

    if (input.amenities && input.amenities.length > 0) {
      await setAmenities(client, accommodationId, input.amenities);
    }
    // Images are attached in a separate step (request an upload URL, upload the bytes
    // directly to storage, then confirm) - see requestImageUploadUrl/confirmAccommodationImage
    // below. They can't be attached at creation time because the object-path namespace is
    // scoped to the accommodation's id, which doesn't exist until this INSERT completes.

    return getAccommodationForOwner(accommodationId, renterUserId, client);
  });
}

async function updateAccommodation(accommodationId, renterUserId, input) {
  return withTransaction(async (client) => {
    await assertOwnsAccommodation(client, accommodationId, renterUserId);

    const fields = [];
    const values = [];
    let i = 1;

    if (input.type !== undefined) {
      fields.push(`type = $${i++}`);
      values.push(input.type);
    }
    if (input.locationText !== undefined) {
      fields.push(`location_text = $${i++}`);
      values.push(input.locationText);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${i++}`);
      values.push(input.description);
    }
    if (input.contactInfo !== undefined) {
      fields.push(`contact_info = $${i++}`);
      values.push(input.contactInfo);
    }
    if (input.nightlyRentNaira !== undefined) {
      fields.push(`nightly_rent_naira = $${i++}`);
      values.push(input.nightlyRentNaira);
    }
    if (input.numberOfUnits !== undefined) {
      // Simplification pending real booking-count reconciliation: units_available is reset
      // to match number_of_units whenever it changes. Fine while no bookings exist yet
      // (booking flow is still "to build" per spec/decisions-and-phasing.md) - revisit once
      // it does, so an in-progress booking's held units aren't silently overwritten.
      fields.push(`number_of_units = $${i++}`, `units_available = $${i++}`);
      values.push(input.numberOfUnits, input.numberOfUnits);
    }
    if (input.state !== undefined || input.area !== undefined) {
      // Need the accommodation's current state/area for whichever half wasn't provided.
      const current = await client.query(
        `SELECT pc.state, pc.area FROM accommodations a
         JOIN price_caps pc ON pc.id = a.price_cap_id
         WHERE a.id = $1`,
        [accommodationId]
      );
      const state = input.state !== undefined ? input.state : current.rows[0].state;
      const area = input.area !== undefined ? input.area : current.rows[0].area;
      const priceCapId = await findPriceCapId(client, { state, area });
      fields.push(`price_cap_id = $${i++}`);
      values.push(priceCapId);
    }

    if (fields.length === 0) {
      throw new ApiError(400, 'No updatable fields were provided.');
    }

    values.push(accommodationId);
    await client.query(
      `UPDATE accommodations SET ${fields.join(', ')}, updated_at = now() WHERE id = $${i}`,
      values
    );

    return getAccommodationForOwner(accommodationId, renterUserId, client);
  });
}

async function setActive(accommodationId, renterUserId, isActive) {
  return withTransaction(async (client) => {
    await assertOwnsAccommodation(client, accommodationId, renterUserId);
    await client.query(
      'UPDATE accommodations SET is_active = $1, updated_at = now() WHERE id = $2',
      [isActive, accommodationId]
    );
    return getAccommodationForOwner(accommodationId, renterUserId, client);
  });
}

async function listOwnAccommodations(renterUserId) {
  const { rows } = await pool.query(
    `SELECT ${LISTING_COLUMNS}
     FROM accommodations a
     JOIN price_caps pc ON pc.id = a.price_cap_id
     WHERE a.renter_user_id = $1
     ORDER BY a.created_at DESC`,
    [renterUserId]
  );
  return Promise.all(rows.map((row) => attachRelations(row)));
}

async function getAccommodationForOwner(accommodationId, renterUserId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${LISTING_COLUMNS}
     FROM accommodations a
     JOIN price_caps pc ON pc.id = a.price_cap_id
     WHERE a.id = $1 AND a.renter_user_id = $2`,
    [accommodationId, renterUserId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Accommodation not found.');
  }
  return attachRelations(rows[0], client);
}

/**
 * Public view of a listing. Contact Information stays hidden until after checkout/payment
 * (spec/requirements-v1.md > Renter Account & Flow) - since the booking/payment flow isn't
 * built yet, this simply never includes contact_info for a non-owner, non-admin viewer. Once
 * checkout exists, this should instead check "has this customer paid for a booking on this
 * listing" and reveal it conditionally.
 */
async function getAccommodationPublic(accommodationId) {
  const { rows } = await pool.query(
    `SELECT ${LISTING_COLUMNS}
     FROM accommodations a
     JOIN price_caps pc ON pc.id = a.price_cap_id
     WHERE a.id = $1 AND a.is_active = true`,
    [accommodationId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Accommodation not found.');
  }
  const full = await attachRelations(rows[0]);
  return stripContactInfo(full);
}

function stripContactInfo(listing) {
  const { contact_info, ...withoutContact } = listing;
  return withoutContact;
}

/**
 * Main Homepage search (spec/requirements-v1.md > Customer-Facing Browse & Booking Flow):
 * filters active listings by location/type/price, and - when a check-in/check-out range is
 * given - annotates each result with unitsAvailableForDates so the search results can already
 * show "3 units left for these dates" the way a hotel/flight search would. Contact info is
 * always stripped, same as the single-listing public view.
 */
async function searchAccommodations({ state, area, type, checkIn, checkOut, minPrice, maxPrice }) {
  const conditions = ['a.is_active = true'];
  const params = [];
  let i = 1;

  if (state) {
    conditions.push(`pc.state = $${i++}`);
    params.push(state);
  }
  if (area) {
    conditions.push(`pc.area = $${i++}`);
    params.push(area);
  }
  if (type) {
    conditions.push(`a.type = $${i++}`);
    params.push(type);
  }
  if (minPrice !== undefined) {
    conditions.push(`a.nightly_rent_naira >= $${i++}`);
    params.push(minPrice);
  }
  if (maxPrice !== undefined) {
    conditions.push(`a.nightly_rent_naira <= $${i++}`);
    params.push(maxPrice);
  }

  const { rows } = await pool.query(
    `SELECT ${LISTING_COLUMNS}
     FROM accommodations a
     JOIN price_caps pc ON pc.id = a.price_cap_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC`,
    params
  );

  const listings = await Promise.all(rows.map((row) => attachRelations(row)));

  if (checkIn && checkOut) {
    await Promise.all(
      listings.map(async (listing) => {
        listing.unitsAvailableForDates = await availability.getUnitsAvailable(
          listing.id,
          listing.number_of_units,
          checkIn,
          checkOut
        );
      })
    );
  }

  return listings.map(stripContactInfo);
}

/**
 * The Bookings Homepage's Units tab (spec/requirements-v1.md): given a stay's check-in/
 * check-out dates, how many of this listing's units are still free, and the nightly rent to
 * price it with (the Rent/Admin Costs/VAT/commission breakdown itself is a separate,
 * not-yet-built checkout module - see decisions log).
 */
async function getAccommodationAvailability(accommodationId, checkIn, checkOut) {
  const { rows } = await pool.query(
    `SELECT number_of_units, nightly_rent_naira
     FROM accommodations
     WHERE id = $1 AND is_active = true`,
    [accommodationId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Accommodation not found.');
  }
  const numberOfUnits = rows[0].number_of_units;
  const nightlyRentNaira = Number(rows[0].nightly_rent_naira);
  const unitsAvailable = await availability.getUnitsAvailable(accommodationId, numberOfUnits, checkIn, checkOut);
  const nights = Math.round(
    (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86400000
  );

  return {
    accommodationId,
    checkIn,
    checkOut,
    nights,
    numberOfUnits,
    unitsAvailable,
    nightlyRentNaira,
  };
}

async function attachRelations(row, client = pool) {
  const [images, amenities, viewingDates] = await Promise.all([
    client.query(
      'SELECT id, url, position FROM accommodation_images WHERE accommodation_id = $1 ORDER BY position ASC',
      [row.id]
    ),
    client.query(
      `SELECT am.id, am.name FROM accommodation_amenities aa
       JOIN amenities am ON am.id = aa.amenity_id
       WHERE aa.accommodation_id = $1 ORDER BY am.name ASC`,
      [row.id]
    ),
    client.query(
      'SELECT available_date, is_booked FROM viewing_availability WHERE accommodation_id = $1 ORDER BY available_date ASC',
      [row.id]
    ),
  ]);

  return {
    ...row,
    images: images.rows,
    amenities: amenities.rows,
    viewingAvailability: viewingDates.rows,
  };
}

async function setAmenities(client, accommodationId, amenityNames) {
  const { rows } = await client.query('SELECT id, name FROM amenities WHERE name = ANY($1)', [
    amenityNames,
  ]);
  const found = new Set(rows.map((r) => r.name));
  const missing = amenityNames.filter((n) => !found.has(n));
  if (missing.length > 0) {
    throw new ApiError(400, `Unknown amenities: ${missing.join(', ')}`);
  }

  await client.query('DELETE FROM accommodation_amenities WHERE accommodation_id = $1', [
    accommodationId,
  ]);
  for (const amenity of rows) {
    await client.query(
      'INSERT INTO accommodation_amenities (accommodation_id, amenity_id) VALUES ($1, $2)',
      [accommodationId, amenity.id]
    );
  }
}

async function replaceAmenities(accommodationId, renterUserId, amenityNames) {
  return withTransaction(async (client) => {
    await assertOwnsAccommodation(client, accommodationId, renterUserId);
    await setAmenities(client, accommodationId, amenityNames);
    return getAccommodationForOwner(accommodationId, renterUserId, client);
  });
}

/**
 * Step 1 of attaching an image: mint a namespaced object path + a short-lived signed URL the
 * Renter's device can PUT the file's bytes to directly (never routed through this server).
 * Nothing is written to the database yet - that happens in confirmAccommodationImage below,
 * once the upload has actually happened.
 */
async function requestImageUploadUrl(accommodationId, renterUserId, contentType) {
  return withTransaction(async (client) => {
    await assertOwnsAccommodation(client, accommodationId, renterUserId);
    const objectPath = storage.generateObjectPath(accommodationId, contentType);
    const { uploadUrl, expiresInSeconds } = await storage.getUploadUrl(objectPath, contentType);
    return { uploadUrl, objectPath, publicUrl: storage.publicUrl(objectPath), expiresInSeconds };
  });
}

/**
 * Step 2: the Renter's device has PUT the bytes to `objectPath` using the signed URL from
 * step 1; this confirms it (via storage.confirmObjectExists - see each provider's caveats
 * about how strong that check actually is) and attaches it to the listing.
 */
async function confirmAccommodationImage(accommodationId, renterUserId, objectPath) {
  return withTransaction(async (client) => {
    await assertOwnsAccommodation(client, accommodationId, renterUserId);

    const expectedPrefix = `accommodations/${accommodationId}/`;
    if (!objectPath.startsWith(expectedPrefix)) {
      throw new ApiError(400, 'This object path was not issued for this accommodation.');
    }

    const exists = await storage.confirmObjectExists(objectPath);
    if (!exists) {
      throw new ApiError(
        422,
        'No uploaded file was found at that path yet. Upload to the signed URL first, then confirm.'
      );
    }

    const { rows: existing } = await client.query(
      'SELECT COALESCE(MAX(position), -1) AS max_position FROM accommodation_images WHERE accommodation_id = $1',
      [accommodationId]
    );
    const position = existing[0].max_position + 1;

    await client.query(
      'INSERT INTO accommodation_images (accommodation_id, url, object_path, position) VALUES ($1, $2, $3, $4)',
      [accommodationId, storage.publicUrl(objectPath), objectPath, position]
    );

    return getAccommodationForOwner(accommodationId, renterUserId, client);
  });
}

async function removeAccommodationImage(accommodationId, renterUserId, imageId) {
  return withTransaction(async (client) => {
    await assertOwnsAccommodation(client, accommodationId, renterUserId);
    const { rows } = await client.query(
      'DELETE FROM accommodation_images WHERE id = $1 AND accommodation_id = $2 RETURNING object_path',
      [imageId, accommodationId]
    );
    if (rows.length === 0) {
      throw new ApiError(404, 'Image not found on this accommodation.');
    }
    if (rows[0].object_path) {
      await storage.deleteObject(rows[0].object_path);
    }
    return getAccommodationForOwner(accommodationId, renterUserId, client);
  });
}

/**
 * Available Viewing Dates tab (spec/requirements-v1.md > Renter Account & Flow): a 30-day
 * calendar where the Renter marks days available for Live Viewing. Dates further out than
 * 30 days from today are rejected, matching the spec's "30-day calendar" framing.
 */
async function setViewingAvailability(accommodationId, renterUserId, dates) {
  return withTransaction(async (client) => {
    await assertOwnsAccommodation(client, accommodationId, renterUserId);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setUTCDate(maxDate.getUTCDate() + 30);

    for (const dateStr of dates) {
      const d = new Date(`${dateStr}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d < today || d > maxDate) {
        throw new ApiError(
          400,
          `"${dateStr}" is outside the 30-day window Renters can mark for Live Viewing.`
        );
      }
    }

    for (const dateStr of dates) {
      await client.query(
        `INSERT INTO viewing_availability (accommodation_id, available_date)
         VALUES ($1, $2)
         ON CONFLICT (accommodation_id, available_date) DO NOTHING`,
        [accommodationId, dateStr]
      );
    }

    return getAccommodationForOwner(accommodationId, renterUserId, client);
  });
}

async function removeViewingAvailability(accommodationId, renterUserId, dateStr) {
  return withTransaction(async (client) => {
    await assertOwnsAccommodation(client, accommodationId, renterUserId);
    const { rows } = await client.query(
      'SELECT is_booked FROM viewing_availability WHERE accommodation_id = $1 AND available_date = $2',
      [accommodationId, dateStr]
    );
    if (rows.length === 0) {
      throw new ApiError(404, 'That date is not currently marked as available.');
    }
    if (rows[0].is_booked) {
      throw new ApiError(
        409,
        'That date already has a Live Viewing booked against it and cannot be unmarked.'
      );
    }
    await client.query(
      'DELETE FROM viewing_availability WHERE accommodation_id = $1 AND available_date = $2',
      [accommodationId, dateStr]
    );
    return getAccommodationForOwner(accommodationId, renterUserId, client);
  });
}

async function listAmenities() {
  const { rows } = await pool.query('SELECT id, name FROM amenities ORDER BY name ASC');
  return rows;
}

async function listPriceCaps() {
  const { rows } = await pool.query(
    'SELECT id, state, area, cap_naira FROM price_caps ORDER BY state ASC, area ASC NULLS FIRST'
  );
  return rows;
}

module.exports = {
  createAccommodation,
  updateAccommodation,
  setActive,
  listOwnAccommodations,
  getAccommodationForOwner,
  getAccommodationPublic,
  searchAccommodations,
  getAccommodationAvailability,
  replaceAmenities,
  requestImageUploadUrl,
  confirmAccommodationImage,
  removeAccommodationImage,
  setViewingAvailability,
  removeViewingAvailability,
  listAmenities,
  listPriceCaps,
};
