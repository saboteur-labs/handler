# Changelog

## [0.1.5](https://github.com/saboteur-labs/handler/compare/handler-v0.1.4...handler-v0.1.5) (2026-06-19)


### Features

* **cli:** add handler gui command ([006212b](https://github.com/saboteur-labs/handler/commit/006212b8ec90feecf4bca8429c68fd3eec09391f))
* **gui:** add agent detail page with run history and Tier A scores ([fc29448](https://github.com/saboteur-labs/handler/commit/fc294489bef5ccfcda6e8ccdd1f6df27251f6b6c))
* **gui:** add conventions and note sections to detail page ([5f66036](https://github.com/saboteur-labs/handler/commit/5f66036074dad169d688238530370e495feb987a))
* **gui:** add core API module for roster and agent detail ([fd164e9](https://github.com/saboteur-labs/handler/commit/fd164e968dffbdeb4df4c5b5ba59f31350386100))
* **gui:** add roster page and table ([9595759](https://github.com/saboteur-labs/handler/commit/9595759cd634c89685b7071f50eea19a703d5d2c))
* **gui:** add thin HTTP server transport over core API ([14c7c1b](https://github.com/saboteur-labs/handler/commit/14c7c1bafc6c05a646e1e84db9e415274eb72723))
* **gui:** add typed API client module ([a8507d0](https://github.com/saboteur-labs/handler/commit/a8507d040b9b747fb45d5cafa87de0e32b615570))
* **gui:** scaffold Vite/React/Tailwind/shadcn SPA ([368c4eb](https://github.com/saboteur-labs/handler/commit/368c4eb66b363b84fbbf8ffa28f66c49346c8b46))
* V1 Feature 6 — Lightweight GUI ([868fd1b](https://github.com/saboteur-labs/handler/commit/868fd1bcf1ecd3fca848af3b3fb0e8327fde6f95))


### Bug Fixes

* **build:** install gui deps before building the SPA ([4d46974](https://github.com/saboteur-labs/handler/commit/4d469745f233be2e4ce6b16787e0833396fc1048))

## [0.1.4](https://github.com/saboteur-labs/handler/compare/handler-v0.1.3...handler-v0.1.4) (2026-06-19)


### Features

* **hook:** add SubagentStop real-time capture hook (V1 Feature 5) ([da68388](https://github.com/saboteur-labs/handler/commit/da68388eb4f514d3ee144b0b59a538ed063a61e7))
* **hook:** SubagentStop real-time capture hook (V1 Feature 5) ([9a67284](https://github.com/saboteur-labs/handler/commit/9a6728454c56dd33c1095ecf40834e5c927894f6))

## [0.1.3](https://github.com/saboteur-labs/handler/compare/handler-v0.1.2...handler-v0.1.3) (2026-06-19)


### Features

* **insights:** add roster-level insights command (V1 Feature 4) ([788c19d](https://github.com/saboteur-labs/handler/commit/788c19dda83e8622a7d75122e11d07d8db154f0d))
* **insights:** roster-level insights command (V1 Feature 4) ([1bb056c](https://github.com/saboteur-labs/handler/commit/1bb056c507b1d57c88ae5449770bfeccd68a4f88))
* **insights:** surface defined-but-unrun agents in no-history bucket ([5a6f1c9](https://github.com/saboteur-labs/handler/commit/5a6f1c9c365d379f0f6e05ebb4633896b6f1a384))

## [0.1.2](https://github.com/saboteur-labs/handler/compare/handler-v0.1.1...handler-v0.1.2) (2026-06-19)


### Features

* **scoring:** add Tier C judged-quality signal (opt-in LLM judge) ([a66b8bf](https://github.com/saboteur-labs/handler/commit/a66b8bfa99f01553210903bde7b6aafcec8cf90c))
* **scoring:** add Tier C judged-quality signal (opt-in LLM judge) ([f69e191](https://github.com/saboteur-labs/handler/commit/f69e1916fcc16b5be97b719c99c470bab07b4d72))

## [0.1.1](https://github.com/saboteur-labs/handler/compare/handler-v0.1.0...handler-v0.1.1) (2026-06-19)


### Features

* **scoring:** add Tier B reference-relative scoring ([#12](https://github.com/saboteur-labs/handler/issues/12)) ([070b9a1](https://github.com/saboteur-labs/handler/commit/070b9a160cb30a7a31febe6a7a11c3ca32f04655))
* **trend:** queryable per-agent trend command ([#10](https://github.com/saboteur-labs/handler/issues/10)) ([a54bfa8](https://github.com/saboteur-labs/handler/commit/a54bfa894ff00b4891be8e3ad0842cf2035b9fa7))

## 0.1.0 (2026-06-18)

### Features

- add 'source register' and 'source list' CLI (Req 5) ([72adbf6](https://github.com/saboteur-labs/handler/commit/72adbf62ad5053746889e482c0a29cee04ebd3dc))
- add activity-derived Tier A checks ([8f5cab5](https://github.com/saboteur-labs/handler/commit/8f5cab507cf719d0df29bf5cda978c3fcd375ad8))
- add agent identity tuple and stable join key (Req 8) ([2001eee](https://github.com/saboteur-labs/handler/commit/2001eee31ecff884fc956db2ae812939e71afb75))
- add agent source model and conventional-folder derivation (Req 4) ([aa3a3b9](https://github.com/saboteur-labs/handler/commit/aa3a3b934423451e64ff98086f456d8d24e67a3b))
- add append-only run store ([f02ed30](https://github.com/saboteur-labs/handler/commit/f02ed3077fa35444fa84167f46e2d359874c7fa1))
- add attributed run model and assembly ([c1d37fe](https://github.com/saboteur-labs/handler/commit/c1d37fe70746e87303eb7bbf1aa896d787867d0c))
- add builtin/plugin agent denylist (Req 3) ([dba7691](https://github.com/saboteur-labs/handler/commit/dba76911c287140588f6d5f5abeabf5b59219036))
- add cwd-nearest-ancestor run resolution (Req 8) ([a08826c](https://github.com/saboteur-labs/handler/commit/a08826c5e4d17f38316862250dd4e6ab486f366b))
- add definition snapshot loader ([9f1151c](https://github.com/saboteur-labs/handler/commit/9f1151ccc7e40626f621aa80207777b00800b9bd))
- add definition tools-scope parser ([c0e2236](https://github.com/saboteur-labs/handler/commit/c0e2236d2696ee36f5899c43d619a6064cba84cc))
- add handler list command ([c27eb7d](https://github.com/saboteur-labs/handler/commit/c27eb7dafa8fb28f297d4827e388b2b01c9ae4f5))
- add handler show command ([d392556](https://github.com/saboteur-labs/handler/commit/d39255673f20c1653fe0a6333c25a8ad645f7064))
- add JSONL reader primitive for transcript ingestion ([e04dcc0](https://github.com/saboteur-labs/handler/commit/e04dcc07f06cb105cdf01b2014baff9eb5580d11))
- add lazy ingestion orchestrator ([1167800](https://github.com/saboteur-labs/handler/commit/1167800c1d09cfd5c401f7fe9690ddec01a0e00d))
- add lazy scoring orchestrator ([28a71e2](https://github.com/saboteur-labs/handler/commit/28a71e29d0d43e4db010cd97f8df54585a6ab896))
- add per-agent metric aggregation ([31b5826](https://github.com/saboteur-labs/handler/commit/31b5826da8c0c4d1922353670081ef1a42931677))
- add persisted source registry (Req 5) ([d42f070](https://github.com/saboteur-labs/handler/commit/d42f070583e79c963da79953d43b8b3877be85a1))
- add run-activity parser for sub-transcripts ([d40984e](https://github.com/saboteur-labs/handler/commit/d40984e2e026aeb87604f3a60d3df78f96c5fe16))
- add scoring rubric (breakdown, band, composite) ([9417d46](https://github.com/saboteur-labs/handler/commit/9417d46e93dbb08e37eeb9e1b9603d8f10260c76))
- add Task-result extraction with toolUseResult schema guard ([ddb1702](https://github.com/saboteur-labs/handler/commit/ddb17027f094f792d5ae74b85d01c0cb3038c076))
- add tool-scope checks (adherence, utilization, undeclared) ([81cb17e](https://github.com/saboteur-labs/handler/commit/81cb17e2511ca309ec07ededfd800209f2577633))
- add transcript discovery for parent sessions ([d076ddb](https://github.com/saboteur-labs/handler/commit/d076ddbaca1e42f81a235fe8f6af194db5e1a087))
- add versioned score-annotation store ([49c8a80](https://github.com/saboteur-labs/handler/commit/49c8a805ecf6e81811a6bef8fc58229948805e5d))
- add write/path boundary checks ([fbfc2a4](https://github.com/saboteur-labs/handler/commit/fbfc2a4ae6108d8f36fade9a01627ee788106f88))
- **conventions:** add `handler conventions` CLI command ([87b4233](https://github.com/saboteur-labs/handler/commit/87b423379e9389b8a7c5781694ae2bc376a7b595))
- **conventions:** add assessment orchestrator + barrel exports ([97937f6](https://github.com/saboteur-labs/handler/commit/97937f6bb2b20f4da7ef0cd570d482b12aaba44d))
- **conventions:** add convention checks engine (16a-e) ([39bd4d8](https://github.com/saboteur-labs/handler/commit/39bd4d874704dbe0172ba83e5e6803b41969056a))
- **conventions:** add conventions artifact schema + offline reader ([d2ff68f](https://github.com/saboteur-labs/handler/commit/d2ff68fe31d4c7258d696ce65939427606c051e5))
- **conventions:** add frontmatter key/value parser ([e571dc9](https://github.com/saboteur-labs/handler/commit/e571dc9a09d77ecf896c6de0af1b64790ca6896f))
- **conventions:** add handler-sync-conventions skill ([dcfb64b](https://github.com/saboteur-labs/handler/commit/dcfb64ba2c8de71f2f63c4bb8425e19d715f0f1f))
- **conventions:** add staleness evaluation ([3526e43](https://github.com/saboteur-labs/handler/commit/3526e43e7fbc724b9b65f3eef482b876c95c59ed))
- **conventions:** ship skill-generated default artifact + fallback ([e2c6a5c](https://github.com/saboteur-labs/handler/commit/e2c6a5c5fa62de2c0bc51faa907bb1d819a6a486))
- **conventions:** static definition assessment & conventions sync (Feature 4) ([3df852b](https://github.com/saboteur-labs/handler/commit/3df852b3292494aa28c594706247c32a74d859d5))
- Feature 1 — agent sources & identity foundation (Reqs 3, 4, 5, 8) ([7117ea6](https://github.com/saboteur-labs/handler/commit/7117ea607eeefce2c1af10ec3362b36107dfa872))
- **notes:** per-agent notes (Feature 5) ([#5](https://github.com/saboteur-labs/handler/issues/5)) ([bba84cc](https://github.com/saboteur-labs/handler/commit/bba84cce632d1f55ae58343e2c90c30963707dbc))
- record sub-transcript locator on the run record ([06c6e1c](https://github.com/saboteur-labs/handler/commit/06c6e1c47a011af392d61c73ec6ab934af808308))
- richer run record & definition-change correlation (Feature 6) ([#6](https://github.com/saboteur-labs/handler/issues/6)) ([7bcba71](https://github.com/saboteur-labs/handler/commit/7bcba7134d06396b6946c015250babbdf848d5ec))
- scaffold TypeScript project and add MVP planning docs ([95471a9](https://github.com/saboteur-labs/handler/commit/95471a94cefea4fc5a79bcb553163818c0ae8dfb))
- surface deterministic scores in handler show ([38465f9](https://github.com/saboteur-labs/handler/commit/38465f9462d27260489831556d3725815a87a9f4))

### Bug Fixes

- discard and rebuild stores on schema-version mismatch ([9288993](https://github.com/saboteur-labs/handler/commit/9288993a16d111c96ab827e883b085c333f8d725))

### Miscellaneous Chores

- release 0.1.0 ([3312f8a](https://github.com/saboteur-labs/handler/commit/3312f8ae81bb8907d5541a19891ce16a9c783903))
