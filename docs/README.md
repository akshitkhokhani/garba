# GARBA documentation

Documentation is grouped by responsibility so product work, catalogue policy, rights work and operating procedures do not compete in one flat directory.

## Catalogue

- [`catalogue/status.md`](catalogue/status.md): current catalogue coverage and known gaps
- [`catalogue/schema.md`](catalogue/schema.md): canonical song/release schema
- [`catalogue/rights.md`](catalogue/rights.md): source, licensing and redistribution policy
- [`catalogue/content-sources.md`](catalogue/content-sources.md): source guidance
- [`catalogue/song-catalog-contract.md`](catalogue/song-catalog-contract.md): player/catalogue integration contract
- [`catalogue/issue-151-foundational-artists-audit.md`](catalogue/issue-151-foundational-artists-audit.md): Atul Purohit, Hemant Chauhan and Praful Dave catalogue-completeness and playback-routing audit
- [`catalogue/issue-152-wave-d-audit.md`](catalogue/issue-152-wave-d-audit.md): Falguni Pathak, Kirtidan Gadhvi, Geeta Rabari and Aditya Gadhvi Wave D catalogue and playback audit
- [`catalogue/issue-152-wave-d2-audit.md`](catalogue/issue-152-wave-d2-audit.md): Geeta Rabari Zankaar 3.0 and Kirtidan Gadhvi Tahukar 10 follow-up audit
- [`catalogue/issue-152-wave-d3-audit.md`](catalogue/issue-152-wave-d3-audit.md): Kirtidan Gadhvi Tahukar 11 complete split-track and exact chapter-routing audit
- [`catalogue/issue-152-wave-d4-audit.md`](catalogue/issue-152-wave-d4-audit.md): Rangili Ramzat 8 YouTube-only split-track migration audit and explicit unresolved handoff
- [`catalogue/issue-152-wave-d5-audit.md`](catalogue/issue-152-wave-d5-audit.md): Geeta Rabari Taal 2022 YouTube-only migration audit with three exact masters and explicit unresolved handoff
- [`catalogue/issue-152-wave-d6-audit.md`](catalogue/issue-152-wave-d6-audit.md): Kirtidan Gadhvi and Anita Pandit Nortani Raat split-album, exact Amazon routing and continuous-master audit
- [`catalogue/issue-152-wave-d7-audit.md`](catalogue/issue-152-wave-d7-audit.md): Kirtidan Gadhvi and Anita Pandit Nortani Raat 2 complete album with YouTube-only executable-route audit
- [`catalogue/issue-152-wave-d8-audit.md`](catalogue/issue-152-wave-d8-audit.md): Aditya Gadhvi and Shruti Ahir Amber Gaje expanded-edition, recording-history and YouTube-only route audit
- [`catalogue/issue-152-wave-d9-audit.md`](catalogue/issue-152-wave-d9-audit.md): Falguni Pathak and Sudesh Bhosle Maadi Tara Mandiriye historical-edition, performer-ownership and exact Sony chapter audit
- [`catalogue/issue-152-closeout.md`](catalogue/issue-152-closeout.md): final four-artist Wave D completeness, rejection and #157 handoff audit
- [`catalogue/issue-157-ramzat-2-youtube-burn-down.md`](catalogue/issue-157-ramzat-2-youtube-burn-down.md): Ramzat 2 exact individual YouTube routes and continuous-set safety boundary
- [`catalogue/issue-231-khamma-2-youtube-migration.md`](catalogue/issue-231-khamma-2-youtube-migration.md): Khamma 2 YouTube-only migration with 20 exact routes and one fail-closed unresolved interlude
- [`catalogue/issue-234-youtube-audit.md`](catalogue/issue-234-youtube-audit.md): Parth Oza Garbe Ghoome Tu exact-recording audit and fail-closed YouTube migration evidence boundary
- [`catalogue/issue-246-youtube-audit.md`](catalogue/issue-246-youtube-audit.md): Hemant Chauhan Ghammar Vol. 3 exact-release audit and fail-closed YouTube migration evidence boundary
- [`catalogue/issue-341-ramzat-2017-youtube-audit.md`](catalogue/issue-341-ramzat-2017-youtube-audit.md): Ramzat 2017 exact YouTube split-track reconciliation and explicit fail-closed evidence boundary
- [`catalogue/issue-346-rangili-ramzat-youtube-audit.md`](catalogue/issue-346-rangili-ramzat-youtube-audit.md): Rangili Ramzat 7/8 exact YouTube split-track audit and explicit evidence boundary
- [`catalogue/issue-347-zankaar-geeta-youtube-audit.md`](catalogue/issue-347-zankaar-geeta-youtube-audit.md): Zankaar 2/3 and Geeta Rabari Taal 2022 exact YouTube split-track reconciliation and fail-closed boundary
- [`catalogue/issue-156-wave-f-audit.md`](catalogue/issue-156-wave-f-audit.md): Wave F 222-candidate discovery, dedupe, ownership and playback-evidence audit
- [`catalogue/issue-156-wave-f-closeout.md`](catalogue/issue-156-wave-f-closeout.md): current-main Wave F closeout metrics, accepted additions, deferred candidates and validation gate
- [`catalogue/nonstop-chapter-resolution-2026-09-08.md`](catalogue/nonstop-chapter-resolution-2026-09-08.md): final evidence audit for source-published Nonstop chapters and intentionally unchaptered continuous masters

## Product

- [`product/design-system.md`](product/design-system.md): visual system and interaction direction
- [`product/playback-runtime-coverage.md`](product/playback-runtime-coverage.md): generated song-route and playback coverage contract
- [`product/playback-controller.md`](product/playback-controller.md): single playback authority, command, transport-evidence and migration contract
- [`product/youtube-first-playback.md`](product/youtube-first-playback.md): one-tap YouTube IFrame playback architecture, route safety and provider fallback hierarchy
- [`product/garba-circle.md`](product/garba-circle.md): listening together in sync without a backend: shared schedule, Date-header clock sync, drift correction and limits
- [`product/responsive-pwa.md`](product/responsive-pwa.md): responsive and installed-app behaviour
- [`product/player-release-acceptance.md`](product/player-release-acceptance.md): finite, evidence-backed player release gate and listening journeys
- [`product/ux-polish-pass.md`](product/ux-polish-pass.md): product polish notes and remaining UX work

## Rights and partnerships

- [`rights/catalogue-partnership-strategy.md`](rights/catalogue-partnership-strategy.md)
- [`rights/licensing-negotiation-queue.md`](rights/licensing-negotiation-queue.md)
- [`rights/licensing-outreach-operations.md`](rights/licensing-outreach-operations.md)
- [`rights/rights-acquisition-wave-01.md`](rights/rights-acquisition-wave-01.md)
- [`rights/rights-request-template.md`](rights/rights-request-template.md)

## Operations

- [`deployment/GITHUB-PAGES.md`](deployment/GITHUB-PAGES.md): production hosting, DNS and cutover runbook
- [`operations/agent-coordination.md`](operations/agent-coordination.md): repository agent-claim coordination protocol
- [`operations/direct-audio-hosting.md`](operations/direct-audio-hosting.md)
- [`operations/domain-split.md`](operations/domain-split.md): public-site and live-player domain cutover runbook
- [`operations/agent-coordination.md`](operations/agent-coordination.md): agent handoff and coordination procedure
- [`operations/hosting-phase-01.md`](operations/hosting-phase-01.md)
- [`operations/master-ingestion-and-publishing.md`](operations/master-ingestion-and-publishing.md)
- [`operations/vendor-catalogue-intake.md`](operations/vendor-catalogue-intake.md)

## Project

- [`project/roadmap.md`](project/roadmap.md): project-level roadmap
- [`project/search-discovery-programme.md`](project/search-discovery-programme.md): SEO, GEO and AEO strategy, baseline, route model, crawl/index rules and Navratri 2026 delivery sequence
- [`project/event-discovery-contract.md`](project/event-discovery-contract.md): source/evidence, identity, freshness, cancellation, expiry and publication gates for future local event discovery

## Naming convention

Documentation files use lowercase kebab-case. `README.md` remains uppercase because it is the conventional directory entry point. New documents should be placed in the narrowest existing responsibility folder instead of being added directly under `docs/`.

`docs/README.md` is the canonical documentation index. `npm run docs:validate` fails when a nested Markdown document is not indexed here, which prevents new documentation from becoming orphaned.
