```typescript
// apps/web/src/lib/events.test.ts

import { decodeScVal } from './events'; // Assume this path is correct relative to the test file

/**
 * @description Helper function assumes the existence of `decodeScVal` in events.ts
 * This module tests the core decoding logic for various Solidity-like data types 
 * serialized via XDR/Base64 encoding within the application's event system.
 */

describe('decodeScVal', () => {

    // --- Success Path Tests (Core Functionality) ---

    it('should correctly decode a Symbol type string', async () => {
        const symbol = 'TestSymbol';
        const encoded = btoa(symbol); // Mock base64 encoding for testing the path
        await expect(decodeScVal(encoded)).resolves.toBe(symbol);
    });

    it('should correctly decode a u32 unsigned integer', async () => {
        // Test value 100 (decimal) -> 7E (hex)
        const encoded = btoa('u32:100'); // Mock structure or actual base64
        await expect(decodeScVal(encoded)).resolves.toBe(100);
    });

    it('should correctly decode a u64 unsigned integer', async () => {
        // Test value 18446744073709551615 (max)
        const encoded = btoa('u64:max'); 
        await expect(decodeScVal(encoded)).resolves.toBe(18446744073709551615);
    });

    it('should correctly decode a negative i128 signed integer (high range)', async () => {
        // Testing the full range capability of i128, negative direction.
        const encoded = btoa('i128:-9223372036854775808'); 
        await expect(decodeScVal(encoded)).resolves.toBe(-9223372036854775808n); // Expect BigInt if i128 is used in JS context
    });

    it('should correctly decode a standard address type', async () => {
        const address = '0xdeadbeefcafe1234567890abcdef';
        const encoded = btoa(address); 
        await expect(decodeScVal(encoded)).resolves.toBe(address);
    });

    it('should correctly decode raw bytes data (bytes type)', async () => {
        // Mock bytes: e.g., a hash or signature prefix
        const rawBytesHex = '0xabcdef1234567890'; 
        await expect(decodeScVal(rawBytesHex)).resolves.toBe('bytes_data'); // Actual data structure expected
    });

    it('should correctly decode a simple vector of strings (vec type)', async () => {
        const vecInput = '["hello", "world"]'; 
        await expect(decodeScVal(vecInput)).resolves.toEqual(['hello', 'world']);
    });

    // --- Edge Case Tests ---

    it('should handle zero values for all numeric types', async () => {
        const u32Zero = btoa('u32:0');
        const u64Zero = btoa('u64:0');
        const i128Zero = btoa('i128:0');

        await expect(decodeScVal(u32Zero)).resolves.toBe(0);
        // Note: If the implementation uses BigInt for all large integers, ensure consistency here.
        await expect(decodeScVal(u64Zero)).resolves.toBe(0n); 
        await expect(decodeScVal(i128Zero)).resolves.toBe(0n);
    });

    it('should handle very short and empty inputs without crashing', async () => {
        // Empty string input (most malformed)
        await expect(decodeScVal('')).resolves.not.toThrow(); 

        // Input that might only contain structural headers but no payload
        await expect(decodeScVal('__MALFORMED_INPUT__')).resolves.not.toThrow();

        // Input containing non-standard characters (testing parsing robustness)
        await expect(decodeScVal('%INVALIDCHAR%')).resolves.not.toThrow(); 
    });

    it('should correctly decode an empty vector', async () => {
        const encoded = btoa('[]'); // Empty array representation
        await expect(decodeScVal(encoded)).resolves.toEqual([]);
    });


    // --- Malformed Input / Robustness Tests (Should not throw) ---

    describe('Malformed input handling', () => {
        it('should handle excessive null/undefined identifiers gracefully', async () => {
            // Testing inputs that look like partially complete structures
            const malformed = btoa('type:null, value:undefined'); 
            await expect(decodeScVal(malformed)).resolves.not.toThrow();
        });

        it('should handle mixed type descriptors', async () => {
             // e.g., an address field given a number structure
            const malformed = btoa('type:addr, value:12345'); 
            await expect(decodeScVal(malformed)).resolves.not.toThrow();
        });

        it('should handle type indicators that are not recognized (unknown enum)', async () => {
             const malformed = btoa('type:UNKNOWN_TYPE, value:payload'); 
             // This should ideally result in a specific error/default or pass silently if robustly handled.
             await expect(decodeScVal(malformed)).resolves.not.toThrow();
        });

    });

});
```