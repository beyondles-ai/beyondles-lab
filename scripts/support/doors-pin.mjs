/**
 * The pinned digests of the shared module `doors` (beyondles-shared), per
 * flavour of the generated copy. Used by `scripts/check-frame.mjs` block 5d
 * (profile lab: the Lab copy in src/lib/doors) and by the core profile
 * (scripts/support/core-profile.mjs: the copy a core product declares in its
 * doors.config.json).
 *
 * sha256 over the file text with line endings normalised to LF. A flavour is
 * what the sync writes for one way of declaring the module in
 * .beyondles-shared.json:
 *
 *   ts      TypeScript source, no import suffix (Labs, Beyondles Suite)
 *   ts+.js  TypeScript source, "importSuffix": ".js" (Beyondles HorAIzon api)
 *   cjs     "variant": "cjs", CommonJS with type declarations (The Brain api)
 *
 * After each doors release: sync, run the check, and replace the tables with
 * the digests the failures list (review that diff like code). The pin is the
 * check that always runs, also where the shared check action cannot (a public
 * repo, a Lab outside the organisation).
 */
import { createHash } from "node:crypto";

export const DOORS_PIN_VERSION = "1.5.1";

export const DOORS_PINS = {
  ts: {
    "door-contract.md":
      "28c4424eb4f2dd18eb581b95550afaeec5de8915983e616f0c0e2c935fbe5e1c",
    "door-host.ts":
      "be91d0975478660f2ec0e6f47853be0c409392e3c8e73a2995f9c6bc3f33438e",
    "exclusions.ts":
      "c6abe070acc215b28633d37c218009cafc847e4f2856fe1416b9d94286b2415a",
    "index.ts":
      "662bf70beb176a5db60ca2d611af8223afadc65596067b5b41313dc8c391b4b9",
    "manifest.ts":
      "e71c8d2eb572b250361a994b119c5fd9d3c6af1c3ec4459da554e6652a557089",
    "on-behalf.ts":
      "0a7c10fa37e84af63a86735ddce31c0d00e4937ad96553bf39d55859c7c7292d",
    "openapi.ts":
      "98b27606b73d33de2c3c180868dee18784d952fbecfc94ce887d50f7b7aae41c",
    "parity.ts":
      "11646b929ee08d70aa2bb7246dd423d0dc50fbd0ae9069509addd1ac779d5a1e",
    "rate-limit.ts":
      "5dbfaa0fd2f469050a97733894cba21712318062a949385f96f9aa24e97ff09e",
    "readers/express.ts":
      "9909a0f6747d85278bcf03b0abbc9a9d18bd6dc998f7b773f4603a9907fb4e8c",
    "readers/next-app-router.ts":
      "f569607cdaf3fccac3adc876d517445322ad15b30cea1230072406fb535690f3",
    "readers/node-fs.ts":
      "8b316d5a75f2aa6f0aea573f04b40fd42dba74653f0bf6d9e27d2723d68cd5f6",
    "readers/source-files.ts":
      "aae5a0fd5d6540d0d4bfa39c8148ec3b128f543c1a7844a8e93721678251343e",
    "scopes.ts":
      "37ca4aeadb2e3cc7e24c153943231b5124696cbb88163ca536494e81ce0914e4",
    "tool-door/call-log.ts":
      "d1b58ac67d0b14257c3892697d245b709bd10020a5475666332f47c3d31142ab",
    "tool-door/describe.ts":
      "3ce5af3c5cf2e10125017cd0bc2e42f99a1bade3f83eb7112abeab0b84f18f13",
    "tool-door/markers.ts":
      "8b216956ca5a0a93be3da168bb4e0ed9b5d530467216774b39c4f7a4dc83d723",
    "tool-door/obo-door.ts":
      "b3aefa1a3c8b73c1a699e9be7bd8354b9acc5e15533564288b805258ed555f35",
    "tool-door/release-gate.ts":
      "6fc658dd26dbeb466d6f368795154f2e75d3efed788e85a82cbd738f6cb02793",
  },
  "ts+.js": {
    "door-contract.md":
      "28c4424eb4f2dd18eb581b95550afaeec5de8915983e616f0c0e2c935fbe5e1c",
    "door-host.ts":
      "be91d0975478660f2ec0e6f47853be0c409392e3c8e73a2995f9c6bc3f33438e",
    "exclusions.ts":
      "a84b8fc152a81020cddc72dfd37892c197b1b2b6ac59f6de5a93ddf5d954324c",
    "index.ts":
      "0a3de9e94a1797db8350cd93b9c6e08bff57544db1df8c15c29c5fba96a3aa1f",
    "manifest.ts":
      "e71c8d2eb572b250361a994b119c5fd9d3c6af1c3ec4459da554e6652a557089",
    "on-behalf.ts":
      "0a7c10fa37e84af63a86735ddce31c0d00e4937ad96553bf39d55859c7c7292d",
    "openapi.ts":
      "06e0dae2c43c0e6996262f8d18b288c05739ba2e1199193e54efd7167d3bf50a",
    "parity.ts":
      "de502675290ab15d66f2e37d41b1e8beae1c48cb175d041cb48139b21c9234f1",
    "rate-limit.ts":
      "5dbfaa0fd2f469050a97733894cba21712318062a949385f96f9aa24e97ff09e",
    "readers/express.ts":
      "54473d30bf007163d9f75153b523f7dba15a809038abc2f807038142659ee410",
    "readers/next-app-router.ts":
      "75437f8907149f827136beafed62c5c9bcc98add8da3379c5520fc443ba99d89",
    "readers/node-fs.ts":
      "bd8d1027a4705a406f0d6e89a22c5eab2617f7397d94215184c9f8f7d84bbdeb",
    "readers/source-files.ts":
      "aae5a0fd5d6540d0d4bfa39c8148ec3b128f543c1a7844a8e93721678251343e",
    "scopes.ts":
      "37ca4aeadb2e3cc7e24c153943231b5124696cbb88163ca536494e81ce0914e4",
    "tool-door/call-log.ts":
      "8d7aef1903046a74ce53c198fae79c7059d07fb122f3be93b950ed38c43bbf82",
    "tool-door/describe.ts":
      "7a86f3b046d2509fd3e81b5d5aabfa2aaeba745133d1cb8e0f87ce8509fc9970",
    "tool-door/markers.ts":
      "8b216956ca5a0a93be3da168bb4e0ed9b5d530467216774b39c4f7a4dc83d723",
    "tool-door/obo-door.ts":
      "b38a2dc79ad4b52c977c1183fee9e8ecace0224e01c61fac21861b90925befbe",
    "tool-door/release-gate.ts":
      "c2dc3dd736a9c685e1df8e9e6922361a67a2b474de69248ecdec168cef8eaf96",
  },
  cjs: {
    "door-contract.md":
      "28c4424eb4f2dd18eb581b95550afaeec5de8915983e616f0c0e2c935fbe5e1c",
    "door-host.d.ts":
      "749d62875dfd7fc64c1db503f5c50aef26e1b429bc45f86aa12031c6449b9edf",
    "door-host.js":
      "420622e5fd43cdc71bffe9aa412cd7825f25167533d84b4bd428374d127b3cf5",
    "exclusions.d.ts":
      "c35fe74d68177d1f1d61c92b598cc6925243d22503c84c3700cab995a3976e26",
    "exclusions.js":
      "4424e0fad315ed94e6cc9b9e8316ab58321ba9661a8f2d7abc0573aaa3b684be",
    "index.d.ts":
      "662bf70beb176a5db60ca2d611af8223afadc65596067b5b41313dc8c391b4b9",
    "index.js":
      "875d55049816308bfa036d12226534f5f226fcdb27f8012f5347b07660a10d4e",
    "manifest.d.ts":
      "c92e05b708f9a08999a7c49e6594b4dff567f606e96b7006bafc2b6cfbba61a9",
    "manifest.js":
      "a697aa4761476d29ad217c71bb8c602e9b4a791c7ae30c97cb7a558ae77f10fb",
    "on-behalf.d.ts":
      "6adac22fffbb46071490beb15cc4ca7446918185b0165c967be0b10b09e1e3d1",
    "on-behalf.js":
      "1845db568b4a0a79b4d40368f4b525dd8ca6f73d066b4608c2250bd398697f93",
    "openapi.d.ts":
      "c3743f1f2f9eea26adbb219b93a92c5475a841c6c9c98f1919fb9d132e966d48",
    "openapi.js":
      "e61d6b0cee35aee614d417a12d762f6498a5c2afa1ae4f8f2adacfa579020302",
    "parity.d.ts":
      "26d81c50249183bdb6f0d6776a4c923a5130601f1786ede78cc0465f4b9653f6",
    "parity.js":
      "c6b8393ef3a84e520137da2585acbf5e1a8ad9d2b69f3e8356502a54cae20da0",
    "rate-limit.d.ts":
      "bd2211ab38b557b8fde2f27f68b2cf49f70397bf4e0e9b1e8f97d6af80ec06c9",
    "rate-limit.js":
      "b6219b03e497f25ed97a91e4d6d0d6e2bba445bb9c15a7de76535202de656e96",
    "readers/express.d.ts":
      "d0969651520a1b64fc0d68dd20116d27f972bbbc7753eec00bce814a08617c3c",
    "readers/express.js":
      "916b719dffe6f6e6703e93fc02b0ef438f0f066fd00c1d35225f8ba28b22a8f5",
    "readers/next-app-router.d.ts":
      "87413dea30e9d1e86aa7e6119b8fac4dca17e30514733a63bdd7f7ac55e1e3fa",
    "readers/next-app-router.js":
      "39e879005c1eccb60223d071cc8902dfb79c1a4399d42659ab4873c9fd04899a",
    "readers/node-fs.d.ts":
      "4e35a46a272f2453658fed329a3863236c27a288b7741c77d4e74276e6d9ee29",
    "readers/node-fs.js":
      "850684588e42c5b5e5e337c6d9129eaa220cb0e503a303722ab48e9258e3b9d0",
    "readers/source-files.d.ts":
      "8b6ba6ac628adafb4f1ddf79cdb47d44dc1853ff7578618fbd8326b7a8b954cd",
    "readers/source-files.js":
      "962ccb288dbb5cfd56d5e46f3f9608c9af09fa4d35447fec739764c08508573f",
    "scopes.d.ts":
      "4721ddc61e6b0b09f8172fc4dc2bc0578fd0c232090ade339c2286aeac1b5da5",
    "scopes.js":
      "b17dc41f1785efd2d4c752fbe3436578dd41c0f258b6c6d6a36ada1607f3444a",
    "tool-door/call-log.d.ts":
      "6fe0d0bd20074cee610d96ea4c0440b31e2845d2152a3f071f015ff4bc574663",
    "tool-door/call-log.js":
      "6b18db0e8ce3a2b53a4955d310035509471c1ea288ef8ef6d344bb3333e3b461",
    "tool-door/describe.d.ts":
      "fef60e4728e65b1a48f0634b0667caf8969e04c076d950a87c4b1a8266bc8385",
    "tool-door/describe.js":
      "5c901ced71c9db1705d918ec422912e164182d3f1609573bb41c337a778cabc4",
    "tool-door/markers.d.ts":
      "d576ba5d1c74f6185207e6e8669c94bb910a340ca098b01550fce830503978ce",
    "tool-door/markers.js":
      "5326184d2e3527795cc831b3c39686f3fe475e31b89c2723b77c38534256ae0a",
    "tool-door/obo-door.d.ts":
      "0a96c57c4091a93202ca64b967c5d91054523c9bb91475fadb1180b2c0250f0a",
    "tool-door/obo-door.js":
      "a73283218fcfe01c27d5b2a2d8ff5b75543936cb6199052d2b57426b7d0c36e8",
    "tool-door/release-gate.d.ts":
      "f8d98a015fff80a1679b8b0b7e26fca76aafb587536e67d6ec337652f5b91623",
    "tool-door/release-gate.js":
      "7bde10bfd28ac22afa6c1d4c8369d0cd09765ab60517d4441760501fccb79434",
  },
};

/**
 * Block 5d: the generated copy of `doors` in `dir` (relative to the product
 * root) is byte for byte the pinned version of `flavour`. `io` reads the
 * product: `read(rel)` returns the text, `exists(rel)` and `list(rel)` (every
 * file below a folder, as paths relative to the product root, with "/").
 * Returns the findings, one sentence each.
 */
export function doorsPinFindings(io, dir, flavour) {
  const files = DOORS_PINS[flavour];
  if (!files)
    return [
      `doors flavour ${JSON.stringify(flavour)} has no pin (known: ${Object.keys(DOORS_PINS).join(", ")})`,
    ];
  if (!io.exists(dir)) return [`${dir} (the copy of doors) is missing`];
  const out = [];
  const version = io.exists(`${dir}/.shared-version`)
    ? io.read(`${dir}/.shared-version`).trim()
    : "";
  if (version !== DOORS_PIN_VERSION)
    out.push(
      `${dir}/.shared-version says "${version}", the frame check pins doors ${DOORS_PIN_VERSION}: update scripts/support/doors-pin.mjs with the sync`,
    );
  const seen = new Set();
  for (const file of io.list(dir)) {
    const name = file.slice(dir.length + 1);
    if (name === ".shared-version") continue;
    seen.add(name);
    const expected = Object.hasOwn(files, name) ? files[name] : undefined;
    const digest = createHash("sha256")
      .update(io.read(file).replace(/\r\n/g, "\n"), "utf8")
      .digest("hex");
    if (expected === undefined)
      out.push(
        `${file} is not part of doors ${DOORS_PIN_VERSION} (sha256 ${digest})`,
      );
    else if (digest !== expected)
      out.push(
        `${file} differs from doors ${DOORS_PIN_VERSION} (sha256 ${digest}, expected ${expected}): change it in beyondles-shared and sync`,
      );
  }
  for (const name of Object.keys(files))
    if (!seen.has(name))
      out.push(`${dir}/${name} of doors ${DOORS_PIN_VERSION} is missing`);
  return out;
}
