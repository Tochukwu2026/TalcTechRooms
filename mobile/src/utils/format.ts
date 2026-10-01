export function formatNaira(amount: number | string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(value)) return '₦0';
  return `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

export const ACCOMMODATION_TYPE_LABELS: Record<string, string> = {
  room: 'Room',
  studio: 'Studio',
  one_bedroom_apartment: '1-Bedroom Apartment',
  bungalow: 'Bungalow',
  multiple_rooms_apartment: 'Multiple-Room Apartment',
  duplex_house: 'Duplex House',
  beach_house: 'Beach House',
};
