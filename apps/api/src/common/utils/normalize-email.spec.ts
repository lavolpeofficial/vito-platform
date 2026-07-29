import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it('entfernt führende/folgende Leerzeichen', () => {
    expect(normalizeEmail('  jane@example.com  ')).toBe('jane@example.com');
  });

  it('wandelt Groß- in Kleinschreibung um', () => {
    expect(normalizeEmail('Jane@Example.COM')).toBe('jane@example.com');
  });

  it('kombiniert trim und lowercase', () => {
    expect(normalizeEmail('  Jane@Example.COM  ')).toBe('jane@example.com');
  });

  it('lässt bereits normalisierte E-Mails unverändert', () => {
    expect(normalizeEmail('jane@example.com')).toBe('jane@example.com');
  });

  it('liefert für unterschiedliche Schreibweisen denselben normalisierten Wert', () => {
    const variants = ['jane@example.com', 'Jane@example.com', ' JANE@EXAMPLE.COM ', 'jane@example.com\t'];
    const normalized = variants.map(normalizeEmail);
    expect(new Set(normalized).size).toBe(1);
  });
});
