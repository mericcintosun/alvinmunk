// Stub for @stellar/stellar-sdk@14's `lib/minimal/bindings/config.js`.
//
// The real module does `require('../../package.json')` via a relative path webpack cannot
// resolve (it points at a non-existent `lib/package.json`). That file is the `contract
// bindings` CODEGEN CLI helper (`ConfigGenerator`) — it is never used at runtime; it only
// gets pulled into the bundle transitively because passkey-kit imports the whole
// `@stellar/stellar-sdk/minimal` barrel. Replacing it with this no-op keeps the bundle
// building. Wired via NormalModuleReplacementPlugin in next.config.mjs.
class ConfigGenerator {}
module.exports = { ConfigGenerator };
