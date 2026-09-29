import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readJSON, writeJSON, remove, getItem, setItem } from './storage';

describe('lib/storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('readJSON', () => {
    it('returns parsed value on valid JSON', () => {
      localStorage.setItem('test_key', JSON.stringify({ a: 1, b: 'hello' }));
      const res = readJSON('test_key', { a: 0, b: '' });
      expect(res).toEqual({ a: 1, b: 'hello' });
    });

    it('returns fallback when key is not found', () => {
      const res = readJSON('missing_key', { fallback: true });
      expect(res).toEqual({ fallback: true });
    });

    it('returns fallback when stored JSON is invalid/corrupted', () => {
      localStorage.setItem('corrupted', '{not json');
      const res = readJSON('corrupted', [1, 2, 3]);
      expect(res).toEqual([1, 2, 3]);
    });

    it('validates with optional validator function', () => {
      localStorage.setItem('valid_num', JSON.stringify(42));
      const isNum = (v: unknown): v is number => typeof v === 'number';
      expect(readJSON('valid_num', 0, isNum)).toBe(42);

      localStorage.setItem('invalid_type', JSON.stringify('not a number'));
      expect(readJSON('invalid_type', 0, isNum)).toBe(0);
    });

    it('returns fallback if window.localStorage getter throws SecurityError', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
        configurable: true,
      });

      try {
        expect(readJSON('any_key', 'fallback_val')).toBe('fallback_val');
      } finally {
        if (original) {
          Object.defineProperty(window, 'localStorage', original);
        }
      }
    });
  });

  describe('writeJSON', () => {
    it('writes valid JSON string to storage and returns true', () => {
      const ok = writeJSON('pref', { dark: true });
      expect(ok).toBe(true);
      expect(localStorage.getItem('pref')).toBe(JSON.stringify({ dark: true }));
    });

    it('handles QuotaExceededError and returns false', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      });

      try {
        const ok = writeJSON('big_data', { data: 'x' });
        expect(ok).toBe(false);
      } finally {
        setItemSpy.mockRestore();
      }
    });

    it('handles throwing localStorage getter and returns false', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
        configurable: true,
      });

      try {
        expect(writeJSON('key', { a: 1 })).toBe(false);
      } finally {
        if (original) {
          Object.defineProperty(window, 'localStorage', original);
        }
      }
    });
  });

  describe('remove', () => {
    it('removes the item from storage and returns true', () => {
      localStorage.setItem('to_delete', 'value');
      expect(remove('to_delete')).toBe(true);
      expect(localStorage.getItem('to_delete')).toBeNull();
    });

    it('handles throwing localStorage getter and returns false', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
        configurable: true,
      });

      try {
        expect(remove('any_key')).toBe(false);
      } finally {
        if (original) {
          Object.defineProperty(window, 'localStorage', original);
        }
      }
    });
  });

  describe('getItem and setItem', () => {
    it('gets raw string item', () => {
      localStorage.setItem('raw_key', 'raw_val');
      expect(getItem('raw_key')).toBe('raw_val');
      expect(getItem('non_existent')).toBeNull();
    });

    it('sets raw string item', () => {
      expect(setItem('raw_key2', 'val2')).toBe(true);
      expect(localStorage.getItem('raw_key2')).toBe('val2');
    });

    it('handles throwing getter or setter gracefully', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
        configurable: true,
      });

      try {
        expect(getItem('raw_key')).toBeNull();
        expect(setItem('raw_key', 'val')).toBe(false);
      } finally {
        if (original) {
          Object.defineProperty(window, 'localStorage', original);
        }
      }
    });
  });
});
