const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAYAAADN5B7xAAAAFElEQVR4nGMQyoj5TwpmGNVACw0ALdKv4VVTVV0AAAAASUVORK5CYII=',
  'base64',
);

export const imageWithCaption = (length: number) => {
  // This valid PNG's ancillary text chunk makes the fixture as large as a
  // typical pasted image without introducing a binary fixture or dependency.
  const type = Buffer.from('tEXt');
  const data = Buffer.from(`Comment\0${'r'.repeat(length)}`);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const sizeBytes = Buffer.alloc(4);
  sizeBytes.writeUInt32BE(data.length);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([
    png.subarray(0, -12),
    sizeBytes,
    type,
    data,
    crcBytes,
    png.subarray(-12),
  ]).toString('base64');
};
