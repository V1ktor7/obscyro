export type Locale = "en" | "fr";
export const LOCALES: Locale[] = ["en"];
export const DEFAULT_LOCALE: Locale = "en";

export const dict = {
  en: {
    "nav.docs": "Docs",
    "nav.pricing": "Offer",
    "nav.signin": "Sign in",
    "nav.getKey": "Get API key",
    "nav.toggleMenu": "Toggle menu",

    "hero.title": "Decision Systems for Health Networks",
    "hero.subtitle":
      "Obscyro connects published health data into one ontology, runs the network as a digital twin, and compares the responses to a surge on what each one actually costs — never on a single blended score.",
    "hero.cta.getKey": "Get API key",
    "hero.cta.studio": "Open Studio",
    "hero.cta.docs": "Read the docs",
    "hero.stat.edition": "Engine",
    "hero.stat.editionValue": "Deterministic",
    "hero.stat.translate": "Terminology",
    "hero.stat.translateValue": "SNOMED IE Feb 2026",
    "hero.responseLabel": "↓ response",
    "hero.scroll": "Scroll to explore",
    "hero.chain.title": "Source to decision",
    "hero.chain.caption": "Every figure keeps its lineage back to the file it came from.",
    "hero.chain.1.label": "Source",
    "hero.chain.1.body": "REST, CSV, stream · on a schedule",
    "hero.chain.2.label": "Pipeline",
    "hero.chain.2.body": "filter · join · derive · expand",
    "hero.chain.3.label": "Ontology",
    "hero.chain.3.body": "objects, links, properties",
    "hero.chain.4.label": "Twin",
    "hero.chain.4.body": "the network, under load",
    "hero.chain.5.label": "Responses",
    "hero.chain.5.body": "ranked by dominance",

    "tour.1": "Data",
    "tour.2": "Pipelines",
    "tour.3": "Ontology",
    "tour.4": "Twin",
    "tour.5": "Dashboards",
    "tour.6": "Responses",
    "cycle.1": "Import",
    "cycle.2": "Transform",
    "cycle.3": "Model",
    "cycle.4": "Simulate",
    "cycle.5": "Compare",
    "cycle.1.note": "A published file, read as it was published.",
    "cycle.2.note": "Rows reshaped into the units a network reasons about.",
    "cycle.3.note": "Object types, their properties, and the links between them.",
    "cycle.4.note": "Demand run against a fixed ceiling until it crosses.",
    "cycle.5.note": "Two responses, one worse on every axis.",
    "cycle.caption": "Every panel is a screen that exists today.",
    "problem.eyebrow": "The problem",
    "problem.title": "A health network cannot compare its own data.",
    "problem.pain1.title": "Every source publishes differently",
    "problem.pain1.body":
      "A facility registry in Windows-1252 with tabs padding a header. An emergency-room census over REST, hourly. Epidemiological series as daily CSV. Same network, four vocabularies, four calendars.",
    "problem.pain2.title": "Reconciliation is manual, and it rots",
    "problem.pain2.body":
      "Cross-walks hand-built once in a spreadsheet break at the next release — and the file that arrives is no longer the file that was published, which is the first thing an audit asks about.",
    "problem.pain3.title": "So the decision gets made on instinct",
    "problem.pain3.body":
      "A surge plan is chosen because it sounds prudent, not because it was compared against the alternatives. Nobody can say what the option not taken would have cost.",
    "problem.diagramEyebrow": "Obscyro in one diagram",
    "problem.node.in": "Published sources",
    "problem.node.api": "Obscyro",
    "problem.node.out": "A ranked answer",

    "arch.eyebrow": "How it works",
    "arch.title": "Four layers, one lineage.",
    "arch.subtitle":
      "Connect what exists, model it once, run it under load, and compare what you could do about it. Each figure on the last screen traces back to the file on the first.",
    "arch.layer1.label": "Connect",
    "arch.layer1.title": "Sources and syncs",
    "arch.layer1.body":
      "Point at a REST endpoint, a file, or a stream and set an interval. Encodings, delimiters and schedules are handled where they belong — not in a spreadsheet before upload.",
    "arch.layer2.label": "Model",
    "arch.layer2.title": "Pipelines into an ontology",
    "arch.layer2.body":
      "A visual graph turns rows into the objects a network actually has: facilities, beds, territories, and the links between them. Terminology coding runs as a node in that graph, not as a separate migration.",
    "arch.layer3.label": "Run",
    "arch.layer3.title": "The digital twin",
    "arch.layer3.body":
      "The model is put under an observed load and the network responds — beds fill, patients wait, transfers move. Deterministic, so the same question always returns the same answer.",
    "arch.layer4.label": "Decide",
    "arch.layer4.title": "Compare the responses",
    "arch.layer4.body":
      "Two protocols, side by side, on deaths, waiting and cost. Ranked by Pareto dominance, so an option that is worse on every axis is named as dominated rather than hidden inside a weighted score nobody agreed on.",

    "features.eyebrow": "What is in it",
    "features.title": "Six capabilities. One lineage.",
    "features.subtitle":
      "Everything below is reachable from the interface and callable over HTTP. Nothing here needs a script to be demonstrated.",
    "features.connect.title": "Connect",
    "features.connect.desc": "REST, file and stream sources on a schedule.",
    "features.transform.title": "Transform",
    "features.transform.desc": "A pipeline graph from rows to objects.",
    "features.code.title": "Code",
    "features.code.desc": "SNOMED ↔ ICD-10, ICD-O and CTV3 over HTTP.",
    "features.model.title": "Model",
    "features.model.desc": "An ontology of what the network has.",
    "features.simulate.title": "Simulate",
    "features.simulate.desc": "The twin under load, and the responses to it.",
    "features.read.title": "Read",
    "features.read.desc": "Charts offered from what the columns hold.",
    "features.showExample": "Show example",
    "features.hideExample": "Hide example",

    "contact.eyebrow": "Get in touch",
    "contact.title": "Interested? Tell us about your network.",
    "contact.what": "Useful to include",
    "contact.p1": "The network you are responsible for, and roughly its size.",
    "contact.p2": "The decision you cannot currently defend with data.",
    "contact.p3": "Where your data lives today, and who publishes it.",
    "contact.cta": "Write to us",
    "contact.orExplore": "Or look first, without talking to anyone:",
    "contact.exploreStudio": "Open the Studio",
    "contact.exploreDocs": "Read the docs",

    "interop.eyebrow": "Interoperability",
    "interop.title": "Two sources. One region they agree on.",
    "interop.subtitle":
      "Nothing is merged and nothing is overwritten. A published file keeps its own vocabulary and its own calendar; what the platform builds is the region where two of them describe the same thing — and that region is the only part a decision can rest on.",
    "interop.note1.title": "Read, not declared",
    "interop.note1.body":
      "A CSV column arrives typed as text whatever it holds. The values are read to find the dates, the measures, the identifiers — which is how a permit number stops being offered as something to sum, and how a date column written the wrong way round gets caught instead of charted.",
    "interop.note2.title": "The file that arrives is the file that was published",
    "interop.note2.body":
      "Encoding, delimiters, unit expansion and coding all happen inside the platform, where they leave a trace. Fixing them in a spreadsheet first is what makes provenance impossible to defend later.",
    "interop.caption": "Sources · agreement · modelled objects",

    "optim.eyebrow": "Operational optimisation",
    "optim.title": "The same arithmetic, whatever the network.",
    "optim.subtitle":
      "The engine reasons about capacity, occupancy and travel time. Not one of its mechanics knows the name of a city or of a disease, which is why a demonstration built on Montréal open data is a demonstration of the machinery rather than of one region.",
    "optim.caption": "Sites · transfers · one model",
    "optim.axis1.title": "Lives",
    "optim.axis1.body": "Cases that went unserved, and what that cost.",
    "optim.axis2.title": "Waiting",
    "optim.axis2.body": "Patient-days spent waiting for a place.",
    "optim.axis3.title": "Cost",
    "optim.axis3.body": "What the response itself consumed.",
    "optim.dominance":
      "Responses are ranked by dominance, never by a weighted score. An option worse on every axis is named as dominated; where two options each win on something, the platform says so instead of inventing an exchange rate between a death and a dollar that nobody agreed to.",

    "statement.lead": "Our software turns a health network’s published files into one model of itself, so a",
    "statement.muted": "surge response can be compared before it is chosen",
    "statement.tail": "rather than argued about after the fact.",

    "sources.title": "What the demonstration runs on.",
    "sources.subtitle":
      "Not a sandbox. The Studio reads published government files, with their real encodings, their real gaps and their real publication schedules.",
    "sources.c1.org": "MSSS · Québec",
    "sources.c1.body":
      "The M02 registry of installations and the capacities authorised at permit. Published in Windows-1252, with tabs padding a column name.",
    "sources.c1.meta": "312 installations · region 06",
    "sources.c2.org": "MSSS · Québec",
    "sources.c2.body":
      "The hourly emergency-room census. Four hospitals in sixteen report “pas d’information disponible”, and the platform says so on every chart.",
    "sources.c2.meta": "REST · hourly",
    "sources.c3.org": "INSPQ · Québec",
    "sources.c3.body":
      "Nine daily epidemiological series — admissions, intensive care, deaths, positivity, variants, reproduction rate. Laid over a run to ask whether it reproduced what happened.",
    "sources.c3.meta": "2020–2023 · daily",
    "sources.c4.org": "PHAC · Canada",
    "sources.c4.body":
      "SARS-CoV-2 in wastewater, by collection basin. An early signal that owes nothing to who came forward for a test.",
    "sources.c4.meta": "89 sampling days",
    "sources.note":
      "One of these arrived with its day and month written the wrong way round. The platform caught it, named it, and it was corrected — which is the point of reading values instead of trusting a schema.",

    "offer.title": "Two layers. One offer, on request.",
    "offer.subtitle":
      "Obscyro is deployed for health networks, on their own data. Everything listed below is in the product today.",
    "offer.a.eyebrow": "Data interoperability",
    "offer.a.title": "One ontology for everything your network publishes.",
    "offer.a.body":
      "Your sources connected, typed and modelled once, in your own vocabulary — with a trace from every figure back to the file it came from.",
    "offer.a.i1": "Connectors for files, REST APIs and streams, synchronised on a schedule",
    "offer.a.i2": "Visual pipelines from rows to objects, every step recorded",
    "offer.a.i3":
      "An ontology of what the network holds — types, links, measures — declared by your institution",
    "offer.a.i4": "Clinical coding over HTTP: SNOMED CT to ICD-10, ICD-O and CTV3",
    "offer.b.eyebrow": "Decision support",
    "offer.b.title": "A digital twin of the network, to compare a response before choosing it.",
    "offer.b.body":
      "The modelled network, live and under load, so that a surge plan is weighed against its alternatives rather than defended after the fact.",
    "offer.b.i1": "A live map of sites, occupancy and the age of every reading",
    "offer.b.i2": "Alerts on thresholds your teams set",
    "offer.b.i3": "Scenario and epidemic simulations, run on your own network",
    "offer.b.i4": "Responses ranked by dominance on lives, waiting and cost",
    "offer.dependency":
      "The decision layer reads what the interoperability layer has connected: it is built on it, not beside it.",
    "offer.pricing":
      "Pricing on request. Every engagement starts with a working session on your data.",

    "demo.cta": "Request a demo",
    "demo.blurb":
      "A demonstration is a working session on your data or on ours. We would rather understand the decision you cannot defend today than present slides.",
    "demo.eyebrow": "Contact / demo request",
    "demo.title": "See it on your own network.",
    "demo.drawerTitle": "Tell us about the network you run.",
    "demo.intro":
      "A few lines are enough. The more precise the problem, the faster this reaches someone who can speak to it.",
    "demo.f.name": "Name",
    "demo.f.email": "Work email",
    "demo.f.role": "Role",
    "demo.f.org": "Organisation",
    "demo.f.network": "The network you are responsible for, and roughly its size",
    "demo.f.problem": "The decision you cannot currently defend with data",
    "demo.send": "Open in my mail client",
    "demo.close": "Close",
    "demo.subject": "Obscyro — demo request",
    "demo.privacy":
      "This panel sends nothing on its own. It composes the message and hands it to your mail client, so none of these fields reaches a server of ours until you press send yourself.",

    "finalCta.title": "See it on public data.",
    "finalCta.subtitle":
      "The Studio runs on published government files — a facility registry, an emergency census, epidemiological series. Open it and follow one figure back to the file it came from.",
    "finalCta.cta": "Open the Studio",

    "footer.product": "Product",
    "footer.standards": "Standards",
    "footer.company": "Company",
    "footer.privacy": "Privacy",
    "footer.terms": "Terms",
    "footer.contact": "Contact",
    "footer.status": "Status",
    "footer.copyright": "© 2026 Obscyro. All rights reserved.",
    "footer.disclaimer":
      "Obscyro is not a medical device. Always validate clinical decisions with qualified healthcare professionals.",
    "footer.tagline":
      "Data interoperability and operational decision support for health networks. Connect published sources, model them once, compare the responses.",

    "signup.title": "Create your Obscyro account",
    "signup.subtitle":
      "Three quick steps. We'll mint a free API key and drop you into the console.",
    "signup.stepLabel": "Step",
    "signup.of": "of",
    "signup.account": "Account",
    "signup.useCase": "Use case",
    "signup.review": "Review",
    "signup.email": "Work email",
    "signup.emailPlaceholder": "you@hospital.com",
    "signup.name": "Full name",
    "signup.namePlaceholder": "Jane Doe",
    "signup.company": "Company (optional)",
    "signup.companyPlaceholder": "Acme Health",
    "signup.useCaseQuestion": "Which best describes you?",
    "signup.useCase.developer": "Developer / engineer",
    "signup.useCase.research": "Researcher / data scientist",
    "signup.useCase.clinical": "Clinician / health system",
    "signup.useCase.other": "Other",
    "signup.terms":
      "I have read the terms of use and agree to them.",
    "signup.next": "Continue",
    "signup.back": "Back",
    "signup.submit": "Generate my API key",
    "signup.submitting": "Generating…",
    "signup.alreadyHaveKey": "Already have a key?",
    "signup.signinHere": "Sign in here",
    "signup.summaryEmail": "Email",
    "signup.summaryName": "Name",
    "signup.summaryCompany": "Company",
    "signup.summaryUseCase": "Use case",
    "signup.summaryPlan": "Plan",
    "signup.planFree": "Free · 1,000 calls / month",
    "signup.errorEmailExists":
      "An account with this email already has an active key. Sign in by pasting that key.",

    "signin.title": "Sign in to Obscyro",
    "signin.subtitle":
      "Access is restricted. Sign in with your account email and access code.",
    "signin.label": "Your API key",
    "signin.placeholder": "obs_live_…",
    "signin.emailLabel": "Email",
    "signin.emailPlaceholder": "you@example.com",
    "signin.codeLabel": "Access code",
    "signin.codePlaceholder": "Enter your access code",
    "signin.submit": "Continue",
    "signin.submitting": "Verifying…",
    "signin.invalid": "Invalid email or access code. Double-check and try again.",
    "signin.keysSubtitle": "Create an API key for this session. Full secrets are shown only once.",
    "signin.welcomeUser": "Welcome back,",
    "signin.existingKeys": "Your active keys",
    "signin.keyNotRecoverable": "Lost a key? Create a new one — full values cannot be recovered.",
    "signin.newKeyName": "Key name",
    "signin.newKeyPlaceholder": "Studio laptop",
    "signin.createKey": "Create API key",
    "signin.creatingKey": "Creating…",
    "signin.keyCreatedOnce": "Copy this key now — you won't see it again.",
    "signin.copyKey": "Copy key",
    "signin.continueStudio": "Open Studio",
    "signin.noAccount": "No account?",

    "app.welcome": "Welcome",
    "app.signOut": "Sign out",
    "app.nav.overview": "Overview",
    "app.nav.keys": "API keys",
    "app.nav.usage": "Usage",
    "app.nav.billing": "Billing",
    "app.nav.settings": "Settings",
    "app.keys.title": "API keys",
    "app.keys.subtitle":
      "Use this token in the Authorization header of every request.",
    "app.keys.your": "Your API key",
    "app.keys.welcomeBanner":
      "Save this key now — for security, the full value will not be shown again.",
    "app.keys.reveal": "Reveal full key",
    "app.keys.hide": "Hide",
    "app.keys.copy": "Copy",
    "app.keys.copied": "Copied!",
    "app.keys.regenerate": "Regenerate",
    "app.keys.plan": "Plan",
    "app.keys.usage": "Usage this month",
    "app.keys.usageLimit": "of 1,000 calls",
    "app.keys.manage": "Manage keys",
    "app.keys.create": "Create key",
    "app.keys.revoke": "Revoke",
    "app.keys.revokeConfirm": "Revoke this API key? Apps using it will stop working.",
    "app.keys.empty": "No active keys yet.",
    "app.keys.lastUsed": "Last used",
    "app.usage.body":
      "Per-endpoint usage breakdowns, daily charts, and quota alerts will live here.",
    "app.settings.body":
      "Profile, team members, and webhook configuration will live here.",
    "app.guard.signinRequired":
      "Sign in to access the console.",
    "app.menu": "Dashboard menu",
    "app.openMenu": "Open dashboard menu",
    "app.closeMenu": "Close menu",

    "app.overview.eyebrow": "Console",
    "app.overview.title": "Overview",
    "app.overview.subtitle": "Your API keys and the documentation, in one place.",
    "app.overview.card.keys.title": "API keys",
    "app.overview.card.keys.desc": "View, copy, and protect your bearer token.",
    "app.overview.card.docs.title": "Documentation",
    "app.overview.card.docs.desc": "HTTP examples, parameters, and response shapes.",
    "app.overview.quickStart.eyebrow": "Quick start",
    "app.overview.quickStart.line1":
      "Send header Authorization: Bearer <your-api-key> on every request.",
    "app.overview.quickStart.line2":
      "Use your deployment API base URL in production, or http://localhost:4000 for the API locally (frontend dev server runs on port 3000).",

    "docs.menu": "Documentation menu",
    "docs.openMenu": "Open documentation menu",
    "docs.closeMenu": "Close menu",
    "nav.features": "Features",
    "footer.features": "Features",
    "product.title": "Six screens. One product.",
    "product.subtitle":
      "Every panel below is a screen that exists today, and each one has a page of its own.",
    "product.explore": "Explore",
    "feat.eyebrow": "Feature",
    "feat.prev": "Previous",
    "feat.next": "Next",
    "feat.data.title": "Every source, read as it was published.",
    "feat.data.lead":
      "Connect files, REST APIs and streams. Obscyro reads what each one actually holds — dates, measures, identifiers, encodings — before anything is built on it.",
    "feat.data.p1.title": "Files, APIs and streams",
    "feat.data.p1.body":
      "Upload a CSV, point at a REST endpoint or receive a stream. Syncs run on a schedule, and every version of a dataset is kept.",
    "feat.data.p2.title": "Read, not declared",
    "feat.data.p2.body":
      "Columns are typed from their values, not their headers. A permit number is never offered as a quantity, and a date column written the wrong way round is caught rather than charted.",
    "feat.data.p3.title": "The file that arrives is the one published",
    "feat.data.p3.body":
      "A file published in Windows-1252 with no declared charset is decoded as what it is. Fixing it first in a spreadsheet would make its provenance impossible to defend.",
    "feat.pipelines.title": "From rows to objects, every step on the canvas.",
    "feat.pipelines.lead":
      "A visual graph turns the rows a publisher writes into the units a network reasons about. Each step can be previewed, and the whole graph runs again when its source changes.",
    "feat.pipelines.p1.title": "Visible at every step",
    "feat.pipelines.p1.body":
      "Filter, join, derive, cast, expand, keep the latest reading. Each node shows what goes in and what comes out before anything is written.",
    "feat.pipelines.p2.title": "Runs on its own",
    "feat.pipelines.p2.body":
      "A live pipeline runs again each time its source is updated, so the model follows an hourly file without anyone pressing a button.",
    "feat.pipelines.p3.title": "Refuses to fail in silence",
    "feat.pipelines.p3.body":
      "A step that would convert nothing, name no column or write nothing is refused, and a run that would remove most of what exists stops and says why.",
    "feat.ontology.title": "One model of what the network holds.",
    "feat.ontology.lead":
      "Object types, their properties and the links between them, declared in your institution’s own vocabulary. Nothing in the engine knows what a bed is.",
    "feat.ontology.p1.title": "Your vocabulary",
    "feat.ontology.p1.body":
      "A site, a ward, a stretcher, an air quality station: the types are yours. The platform reads what each one declares instead of matching on names.",
    "feat.ontology.p2.title": "Measured or assumed, on the record",
    "feat.ontology.p2.body":
      "A property can say where its value comes from, when it was observed and what it is about — and the screen shows that next to the number.",
    "feat.ontology.p3.title": "Clinical terminologies",
    "feat.ontology.p3.body":
      "SNOMED CT concepts translated to ICD-10, ICD-O and CTV3 over HTTP, for data that arrives coded differently from one source to the next.",
    "feat.twin.title": "The network, live, on one map.",
    "feat.twin.lead":
      "Sites, units and sensors placed on a map. Every figure carries how old it is and where it came from.",
    "feat.twin.p1.title": "Live readings",
    "feat.twin.p1.body":
      "Occupancy, air quality and wastewater signals refresh as their sources publish, and each reading shows its age.",
    "feat.twin.p2.title": "Alerts on your thresholds",
    "feat.twin.p2.body":
      "Rules your teams set raise an alert when a measure crosses its threshold, and close it when the measure comes back.",
    "feat.twin.p3.title": "Absent is not calm",
    "feat.twin.p3.body":
      "A site with no reading is drawn as having none, not as fine. A boundary that is approximate says so, on the map.",
    "feat.dashboards.title": "Charts offered from what the columns hold.",
    "feat.dashboards.lead":
      "Dashboards on your datasets, the live twin and simulation runs. The platform reads each column and offers only the charts its values can support.",
    "feat.dashboards.p1.title": "The right chart, or a reason",
    "feat.dashboards.p1.body":
      "A date stored as text is drawn as time, and a permit number is never summed. A column that cannot be charted says why instead of producing nonsense.",
    "feat.dashboards.p2.title": "Always current",
    "feat.dashboards.p2.body":
      "A card stores no values. Its numbers are read when the page opens, so an hourly sync reaches the dashboard without anyone touching it.",
    "feat.dashboards.p3.title": "The twin and its runs",
    "feat.dashboards.p3.body":
      "Map cards show the network live, in a scenario or frozen at a step of a run. Series cards put a simulated trajectory beside the observed one.",
    "feat.responses.title": "Compare a response before choosing it.",
    "feat.responses.lead":
      "Run an event — an epidemic wave, a surge, a closure — against the modelled network, try responses, and see what each one costs.",
    "feat.responses.p1.title": "Scenarios and epidemics",
    "feat.responses.p1.body":
      "Replay an observed wave on today’s network, or seed an epidemic in one territory and watch it spread to the others.",
    "feat.responses.p2.title": "Ranked by dominance",
    "feat.responses.p2.body":
      "Responses are compared on lives, waiting and cost. One worse on every axis is named dominated, and no exchange rate between a death and a dollar is invented.",
    "feat.responses.p3.title": "Deterministic",
    "feat.responses.p3.body":
      "The same inputs give the same result, so asking what acting on day 42 would have changed is a rerun, not a guess.",

  },
  fr: {
    "nav.docs": "Docs",
    "nav.pricing": "Offre",
    "nav.signin": "Connexion",
    "nav.getKey": "Obtenir une clé",
    "nav.toggleMenu": "Ouvrir le menu",

    "hero.title": "Des systèmes de décision pour les réseaux de santé",
    "hero.subtitle":
      "Obscyro relie les données publiées en une seule ontologie, fait tourner le réseau comme un jumeau numérique, et compare les réponses à une poussée sur ce que chacune coûte réellement — jamais sur un score unique.",
    "hero.cta.getKey": "Obtenir une clé API",
    "hero.cta.studio": "Ouvrir le Studio",
    "hero.cta.docs": "Lire la documentation",
    "hero.stat.edition": "Moteur",
    "hero.stat.editionValue": "Déterministe",
    "hero.stat.translate": "Terminologie",
    "hero.stat.translateValue": "SNOMED IE fév. 2026",
    "hero.responseLabel": "↓ réponse",
    "hero.scroll": "Faites défiler",
    "hero.chain.title": "De la source à la décision",
    "hero.chain.caption": "Chaque chiffre garde sa lignée jusqu’au fichier d’origine.",
    "hero.chain.1.label": "Source",
    "hero.chain.1.body": "REST, CSV, flux · à intervalle",
    "hero.chain.2.label": "Pipeline",
    "hero.chain.2.body": "filtrer · joindre · dériver · déplier",
    "hero.chain.3.label": "Ontologie",
    "hero.chain.3.body": "objets, liens, propriétés",
    "hero.chain.4.label": "Jumeau",
    "hero.chain.4.body": "le réseau, sous charge",
    "hero.chain.5.label": "Réponses",
    "hero.chain.5.body": "classées par dominance",

    "tour.1": "Données",
    "tour.2": "Pipelines",
    "tour.3": "Ontologie",
    "tour.4": "Jumeau",
    "tour.5": "Tableaux de bord",
    "tour.6": "Réponses",
    "cycle.1": "Importer",
    "cycle.2": "Transformer",
    "cycle.3": "Modéliser",
    "cycle.4": "Simuler",
    "cycle.5": "Comparer",
    "cycle.1.note": "Un fichier publié, lu tel qu’il a été publié.",
    "cycle.2.note": "Des lignes remodelées en unités dont un réseau raisonne.",
    "cycle.3.note": "Types d’objets, propriétés, et les liens entre eux.",
    "cycle.4.note": "La demande poussée contre un plafond fixe jusqu’au franchissement.",
    "cycle.5.note": "Deux réponses, l’une pire sur tous les axes.",
    "cycle.caption": "Chaque panneau est un écran qui existe aujourd’hui.",
    "problem.eyebrow": "Le problème",
    "problem.title": "Un réseau de santé ne peut pas comparer ses propres données.",
    "problem.pain1.title": "Chaque source publie à sa façon",
    "problem.pain1.body":
      "Un répertoire d’installations en Windows-1252 avec des tabulations dans l’en-tête. Un relevé des urgences en REST, à l’heure. Des séries épidémiologiques en CSV quotidien. Même réseau, quatre vocabulaires, quatre calendriers.",
    "problem.pain2.title": "La réconciliation est manuelle, et elle pourrit",
    "problem.pain2.body":
      "Une correspondance bâtie une fois dans un tableur casse à la publication suivante — et le fichier qui arrive n’est plus celui qui a été publié, ce qu’un audit demande en premier.",
    "problem.pain3.title": "Alors la décision se prend à l’instinct",
    "problem.pain3.body":
      "Un plan de délestage est choisi parce qu’il paraît prudent, pas parce qu’il a été comparé. Personne ne peut dire ce qu’aurait coûté l’option écartée.",
    "problem.diagramEyebrow": "Obscyro en un schéma",
    "problem.node.in": "Sources publiées",
    "problem.node.api": "Obscyro",
    "problem.node.out": "Une réponse classée",

    "arch.eyebrow": "Comment ça marche",
    "arch.title": "Quatre couches, une seule lignée.",
    "arch.subtitle":
      "Relier ce qui existe, le modéliser une fois, le faire tourner sous charge, puis comparer ce qu’on peut y faire. Chaque chiffre du dernier écran remonte au fichier du premier.",
    "arch.layer1.label": "Relier",
    "arch.layer1.title": "Sources et synchronisations",
    "arch.layer1.body":
      "Pointer une adresse REST, un fichier ou un flux, et fixer un intervalle. Encodages, séparateurs et horaires sont traités là où est leur place — pas dans un tableur avant l’envoi.",
    "arch.layer2.label": "Modéliser",
    "arch.layer2.title": "Des pipelines vers une ontologie",
    "arch.layer2.body":
      "Un graphe visuel transforme des lignes en objets que le réseau possède vraiment : installations, lits, territoires, et les liens entre eux. Le codage terminologique y est un nœud, pas une migration à part.",
    "arch.layer3.label": "Exécuter",
    "arch.layer3.title": "Le jumeau numérique",
    "arch.layer3.body":
      "Le modèle est mis sous une charge observée et le réseau réagit — les lits se remplissent, les patients attendent, les transferts partent. Déterministe : la même question rend toujours la même réponse.",
    "arch.layer4.label": "Décider",
    "arch.layer4.title": "Comparer les réponses",
    "arch.layer4.body":
      "Deux protocoles côte à côte, sur les décès, l’attente et le coût. Classés par dominance de Pareto : une option pire sur tous les axes est nommée dominée plutôt que noyée dans un score pondéré que personne n’a approuvé.",

    "features.eyebrow": "Ce qu’il y a dedans",
    "features.title": "Six capacités. Une seule lignée.",
    "features.subtitle":
      "Tout ce qui suit est accessible depuis l’interface et appelable en HTTP. Rien ici n’a besoin d’un script pour être montré.",
    "features.connect.title": "Relier",
    "features.connect.desc": "Sources REST, fichier et flux, à intervalle.",
    "features.transform.title": "Transformer",
    "features.transform.desc": "Un graphe des lignes vers les objets.",
    "features.code.title": "Coder",
    "features.code.desc": "SNOMED ↔ CIM-10, CIM-O et CTV3 en HTTP.",
    "features.model.title": "Modéliser",
    "features.model.desc": "Une ontologie de ce que le réseau possède.",
    "features.simulate.title": "Simuler",
    "features.simulate.desc": "Le jumeau sous charge, et les réponses.",
    "features.read.title": "Lire",
    "features.read.desc": "Des graphiques déduits du contenu des colonnes.",
    "features.showExample": "Voir l’exemple",
    "features.hideExample": "Masquer l’exemple",

    "contact.eyebrow": "Nous joindre",
    "contact.title": "Intéressé ? Parlez-nous de votre réseau.",
    "contact.what": "Utile à préciser",
    "contact.p1": "Le réseau dont vous avez la charge, et son ordre de grandeur.",
    "contact.p2": "La décision que vous ne pouvez pas défendre avec vos données aujourd’hui.",
    "contact.p3": "Où vivent vos données, et qui les publie.",
    "contact.cta": "Écrivez-nous",
    "contact.orExplore": "Ou regardez d’abord, sans parler à personne :",
    "contact.exploreStudio": "Ouvrir le Studio",
    "contact.exploreDocs": "Lire la documentation",

    "interop.eyebrow": "Interopérabilité",
    "interop.title": "Deux sources. Une région où elles s’accordent.",
    "interop.subtitle":
      "Rien n’est fusionné, rien n’est écrasé. Un fichier publié garde son vocabulaire et son calendrier ; ce que la plateforme construit, c’est la région où deux d’entre eux décrivent la même chose — et c’est la seule part sur laquelle une décision peut reposer.",
    "interop.note1.title": "Lu, pas déclaré",
    "interop.note1.body":
      "Une colonne de CSV arrive typée en texte quoi qu’elle contienne. Les valeurs sont lues pour trouver les dates, les mesures, les identifiants — c’est ainsi qu’un numéro de permis cesse d’être proposé à l’addition, et qu’une colonne de dates écrite à l’envers est attrapée au lieu d’être tracée.",
    "interop.note2.title": "Le fichier qui arrive est celui qui a été publié",
    "interop.note2.body":
      "Encodage, séparateurs, dépliage en unités et codage se font dans la plateforme, où ils laissent une trace. Les corriger d’abord dans un tableur, c’est rendre la provenance indéfendable ensuite.",
    "interop.caption": "Sources · accord · objets modélisés",

    "optim.eyebrow": "Optimisation opérationnelle",
    "optim.title": "La même arithmétique, quel que soit le réseau.",
    "optim.subtitle":
      "Le moteur raisonne sur la capacité, l’occupation et le temps de trajet. Aucune de ses mécaniques ne connaît le nom d’une ville ni d’une maladie, et c’est pourquoi une démonstration bâtie sur les données ouvertes de Montréal démontre la machinerie plutôt qu’une région.",
    "optim.caption": "Sites · transferts · un seul modèle",
    "optim.axis1.title": "Vies",
    "optim.axis1.body": "Les cas non servis, et ce qu’ils ont coûté.",
    "optim.axis2.title": "Attente",
    "optim.axis2.body": "Les jours-patients passés à attendre une place.",
    "optim.axis3.title": "Coût",
    "optim.axis3.body": "Ce que la réponse elle-même a consommé.",
    "optim.dominance":
      "Les réponses sont classées par dominance, jamais par un score pondéré. Une option pire sur tous les axes est nommée dominée ; là où deux options gagnent chacune sur quelque chose, la plateforme le dit plutôt que d’inventer entre un décès et un dollar un taux de change que personne n’a approuvé.",

    "statement.lead": "Notre logiciel transforme les fichiers publiés d’un réseau de santé en un modèle de lui-même, pour qu’une",
    "statement.muted": "réponse à une poussée puisse être comparée avant d’être choisie",
    "statement.tail": "plutôt que débattue après coup.",

    "sources.title": "Ce sur quoi tourne la démonstration.",
    "sources.subtitle":
      "Pas un bac à sable. Le Studio lit des fichiers gouvernementaux publiés, avec leurs encodages réels, leurs trous réels et leurs calendriers de publication réels.",
    "sources.c1.org": "MSSS · Québec",
    "sources.c1.body":
      "Le répertoire M02 des installations et les capacités autorisées au permis. Publié en Windows-1252, avec des tabulations dans un nom de colonne.",
    "sources.c1.meta": "312 installations · région 06",
    "sources.c2.org": "MSSS · Québec",
    "sources.c2.body":
      "Le relevé horaire des urgences. Quatre hôpitaux sur seize déclarent « pas d’information disponible », et la plateforme l’écrit sur chaque graphique.",
    "sources.c2.meta": "REST · à l’heure",
    "sources.c3.org": "INSPQ · Québec",
    "sources.c3.body":
      "Neuf séries épidémiologiques quotidiennes — admissions, soins intensifs, décès, positivité, variants, taux de reproduction. Posées sur une course pour demander si elle a reproduit ce qui est arrivé.",
    "sources.c3.meta": "2020–2023 · quotidien",
    "sources.c4.org": "ASPC · Canada",
    "sources.c4.body":
      "SRAS-CoV-2 dans les eaux usées, par bassin de collecte. Un signal précoce qui ne doit rien à qui s’est présenté au dépistage.",
    "sources.c4.meta": "89 jours d’échantillonnage",
    "sources.note":
      "L’un d’eux est arrivé avec le jour et le mois écrits à l’envers. La plateforme l’a attrapé, l’a nommé, et il a été corrigé — c’est tout l’intérêt de lire les valeurs plutôt que de faire confiance à un schéma.",

    "offer.title": "Deux volets. Une offre, sur demande.",
    "offer.subtitle":
      "Obscyro se déploie pour des réseaux de santé, sur leurs propres données. Tout ce qui est décrit ci-dessous fait partie du produit aujourd’hui.",
    "offer.a.eyebrow": "Interopérabilité des données",
    "offer.a.title": "Une ontologie pour tout ce que votre réseau publie.",
    "offer.a.body":
      "Vos sources reliées, typées et modélisées une fois, dans votre propre vocabulaire — avec la trace de chaque chiffre jusqu’au fichier d’où il vient.",
    "offer.a.i1": "Connecteurs pour fichiers, API REST et flux, synchronisés à intervalle",
    "offer.a.i2": "Pipelines visuels des lignes vers les objets, chaque étape tracée",
    "offer.a.i3":
      "Une ontologie de ce que le réseau possède — types, liens, mesures — déclarée par votre institution",
    "offer.a.i4": "Codage clinique en HTTP : SNOMED CT vers CIM-10, CIM-O et CTV3",
    "offer.b.eyebrow": "Aide à la décision",
    "offer.b.title":
      "Un jumeau numérique du réseau, pour comparer une réponse avant de la choisir.",
    "offer.b.body":
      "Le réseau modélisé, en direct et sous charge, pour qu’un plan de délestage soit pesé contre ses alternatives plutôt que défendu après coup.",
    "offer.b.i1": "Une carte en direct des sites, de l’occupation et de l’âge de chaque lecture",
    "offer.b.i2": "Des alertes sur les seuils que vos équipes fixent",
    "offer.b.i3": "Des simulations de scénarios et d’épidémies, sur votre propre réseau",
    "offer.b.i4": "Des réponses classées par dominance sur les vies, l’attente et le coût",
    "offer.dependency":
      "Le volet décision lit ce que le volet interopérabilité a relié : il repose sur lui, il ne s’y ajoute pas.",
    "offer.pricing":
      "Tarif sur demande. Chaque engagement commence par une séance de travail sur vos données.",

    "demo.cta": "Demander une démonstration",
    "demo.blurb":
      "Une démonstration est une séance de travail sur vos données ou sur les nôtres. Nous préférons comprendre la décision que vous ne pouvez pas défendre aujourd’hui que présenter des diapositives.",
    "demo.eyebrow": "Contact / demande de démonstration",
    "demo.title": "Voyez-le sur votre propre réseau.",
    "demo.drawerTitle": "Parlez-nous du réseau dont vous avez la charge.",
    "demo.intro":
      "Quelques lignes suffisent. Plus le problème est précis, plus vite ceci atteint quelqu’un capable d’en parler.",
    "demo.f.name": "Nom",
    "demo.f.email": "Courriel professionnel",
    "demo.f.role": "Fonction",
    "demo.f.org": "Organisation",
    "demo.f.network": "Le réseau dont vous avez la charge, et son ordre de grandeur",
    "demo.f.problem": "La décision que vous ne pouvez pas défendre avec vos données aujourd’hui",
    "demo.send": "Ouvrir dans ma messagerie",
    "demo.close": "Fermer",
    "demo.subject": "Obscyro — demande de démonstration",
    "demo.privacy":
      "Ce panneau n’envoie rien de lui-même. Il compose le message et le remet à votre messagerie : aucun de ces champs n’atteint un de nos serveurs tant que vous n’avez pas appuyé sur envoyer vous-même.",

    "finalCta.title": "Voyez-le sur des données publiques.",
    "finalCta.subtitle":
      "Le Studio tourne sur des fichiers gouvernementaux publiés — un répertoire d’installations, un relevé des urgences, des séries épidémiologiques. Ouvrez-le et remontez un chiffre jusqu’à son fichier.",
    "finalCta.cta": "Ouvrir le Studio",

    "footer.product": "Produit",
    "footer.standards": "Standards",
    "footer.company": "Entreprise",
    "footer.privacy": "Confidentialité",
    "footer.terms": "Conditions",
    "footer.contact": "Contact",
    "footer.status": "Statut",
    "footer.copyright": "© 2026 Obscyro. Tous droits réservés.",
    "footer.disclaimer":
      "Obscyro n'est pas un dispositif médical. Validez toujours les décisions cliniques avec des professionnels de santé qualifiés.",
    "footer.tagline":
      "Interopérabilité des données et aide à la décision opérationnelle pour les réseaux de santé. Relier les sources publiées, les modéliser une fois, comparer les réponses.",

    "signup.title": "Créez votre compte Obscyro",
    "signup.subtitle":
      "Trois étapes rapides. On génère une clé API gratuite et on vous emmène dans la console.",
    "signup.stepLabel": "Étape",
    "signup.of": "sur",
    "signup.account": "Compte",
    "signup.useCase": "Cas d'usage",
    "signup.review": "Récap",
    "signup.email": "Email professionnel",
    "signup.emailPlaceholder": "vous@hopital.fr",
    "signup.name": "Nom complet",
    "signup.namePlaceholder": "Jeanne Dupont",
    "signup.company": "Entreprise (optionnel)",
    "signup.companyPlaceholder": "Acme Santé",
    "signup.useCaseQuestion": "Qu'est-ce qui vous décrit le mieux ?",
    "signup.useCase.developer": "Développeur / ingénieur",
    "signup.useCase.research": "Chercheur / data scientist",
    "signup.useCase.clinical": "Clinicien / établissement de santé",
    "signup.useCase.other": "Autre",
    "signup.terms":
      "J’ai lu les conditions d’utilisation et je les accepte.",
    "signup.next": "Continuer",
    "signup.back": "Retour",
    "signup.submit": "Générer ma clé API",
    "signup.submitting": "Génération…",
    "signup.alreadyHaveKey": "Déjà une clé ?",
    "signup.signinHere": "Connectez-vous ici",
    "signup.summaryEmail": "Email",
    "signup.summaryName": "Nom",
    "signup.summaryCompany": "Entreprise",
    "signup.summaryUseCase": "Cas d'usage",
    "signup.summaryPlan": "Plan",
    "signup.planFree": "Free · 1 000 appels / mois",
    "signup.errorEmailExists":
      "Un compte avec cet email a déjà une clé active. Connectez-vous en collant cette clé.",

    "signin.title": "Connexion à Obscyro",
    "signin.subtitle":
      "L'accès est restreint. Connectez-vous avec l'email et le code d'accès de votre compte.",
    "signin.label": "Votre clé API",
    "signin.placeholder": "obs_live_…",
    "signin.emailLabel": "Email",
    "signin.emailPlaceholder": "vous@exemple.com",
    "signin.codeLabel": "Code d'accès",
    "signin.codePlaceholder": "Entrez votre code d'accès",
    "signin.submit": "Continuer",
    "signin.submitting": "Vérification…",
    "signin.invalid": "Email ou code d'accès invalide. Vérifiez et réessayez.",
    "signin.keysSubtitle": "Créez une clé API pour cette session. Le secret complet n'est affiché qu'une fois.",
    "signin.welcomeUser": "Bon retour,",
    "signin.existingKeys": "Vos clés actives",
    "signin.keyNotRecoverable": "Clé perdue ? Créez-en une nouvelle — les valeurs complètes ne sont pas récupérables.",
    "signin.newKeyName": "Nom de la clé",
    "signin.newKeyPlaceholder": "Studio portable",
    "signin.createKey": "Créer une clé API",
    "signin.creatingKey": "Création…",
    "signin.keyCreatedOnce": "Copiez cette clé maintenant — elle ne sera plus affichée.",
    "signin.copyKey": "Copier la clé",
    "signin.continueStudio": "Ouvrir Studio",
    "signin.noAccount": "Pas de compte ?",

    "app.welcome": "Bienvenue",
    "app.signOut": "Se déconnecter",
    "app.nav.overview": "Tableau de bord",
    "app.nav.keys": "Clés API",
    "app.nav.usage": "Usage",
    "app.nav.billing": "Facturation",
    "app.nav.settings": "Paramètres",
    "app.keys.title": "Clés API",
    "app.keys.subtitle":
      "Utilisez ce jeton dans l'en-tête Authorization de chaque requête.",
    "app.keys.your": "Votre clé API",
    "app.keys.welcomeBanner":
      "Sauvegardez cette clé maintenant — pour la sécurité, la valeur complète ne sera plus affichée.",
    "app.keys.reveal": "Afficher la clé",
    "app.keys.hide": "Masquer",
    "app.keys.copy": "Copier",
    "app.keys.copied": "Copié !",
    "app.keys.regenerate": "Régénérer",
    "app.keys.plan": "Plan",
    "app.keys.usage": "Usage ce mois-ci",
    "app.keys.usageLimit": "sur 1 000 appels",
    "app.keys.manage": "Gérer les clés",
    "app.keys.create": "Créer une clé",
    "app.keys.revoke": "Révoquer",
    "app.keys.revokeConfirm": "Révoquer cette clé ? Les apps qui l'utilisent cesseront de fonctionner.",
    "app.keys.empty": "Aucune clé active.",
    "app.keys.lastUsed": "Dernière utilisation",
    "app.usage.body":
      "Les détails d'usage par endpoint, graphiques quotidiens et alertes de quota apparaîtront ici.",
    "app.settings.body":
      "Profil, membres d'équipe et configuration des webhooks apparaîtront ici.",
    "app.guard.signinRequired":
      "Connectez-vous pour accéder à la console.",
    "app.menu": "Menu du tableau de bord",
    "app.openMenu": "Ouvrir le menu du tableau de bord",
    "app.closeMenu": "Fermer le menu",

    "app.overview.eyebrow": "Console",
    "app.overview.title": "Vue d'ensemble",
    "app.overview.subtitle": "Vos clés API et la documentation, au même endroit.",
    "app.overview.card.keys.title": "Clés API",
    "app.overview.card.keys.desc": "Consulter, copier et protéger votre jeton bearer.",
    "app.overview.card.docs.title": "Documentation",
    "app.overview.card.docs.desc": "Exemples HTTP, paramètres et formes de réponse.",
    "app.overview.quickStart.eyebrow": "Démarrage rapide",
    "app.overview.quickStart.line1":
      "En-tête obligatoire : Authorization: Bearer <votre-clé-api> sur chaque requête.",
    "app.overview.quickStart.line2":
      "Utilisez l'URL de base de l'API en production, ou http://localhost:4000 pour l'API en local (le frontend de dev tourne sur le port 3000).",

    "docs.menu": "Menu de documentation",
    "docs.openMenu": "Ouvrir le menu de documentation",
    "docs.closeMenu": "Fermer le menu",
    "nav.features": "Fonctionnalités",
    "footer.features": "Fonctionnalités",
    "product.title": "Six écrans. Un seul produit.",
    "product.subtitle":
      "Chaque panneau ci-dessous est un écran qui existe aujourd’hui, et chacun a sa propre page.",
    "product.explore": "Découvrir",
    "feat.eyebrow": "Fonctionnalité",
    "feat.prev": "Précédente",
    "feat.next": "Suivante",
    "feat.data.title": "Chaque source, lue telle qu’elle a été publiée.",
    "feat.data.lead":
      "Reliez des fichiers, des API REST et des flux. Obscyro lit ce que chacun contient vraiment — dates, mesures, identifiants, encodages — avant que quoi que ce soit ne soit construit dessus.",
    "feat.data.p1.title": "Fichiers, API et flux",
    "feat.data.p1.body":
      "Téléversez un CSV, pointez une API REST ou recevez un flux. Les synchronisations tournent à intervalle, et chaque version d’un jeu de données est conservée.",
    "feat.data.p2.title": "Lu, pas déclaré",
    "feat.data.p2.body":
      "Les colonnes sont typées d’après leurs valeurs, pas leurs en-têtes. Un numéro de permis n’est jamais proposé comme quantité, et une colonne de dates écrite à l’envers est attrapée au lieu d’être tracée.",
    "feat.data.p3.title": "Le fichier qui arrive est celui qui a été publié",
    "feat.data.p3.body":
      "Un fichier publié en Windows-1252 sans encodage déclaré est décodé pour ce qu’il est. Le corriger d’abord dans un tableur rendrait sa provenance indéfendable.",
    "feat.pipelines.title": "Des lignes aux objets, chaque étape sur le canevas.",
    "feat.pipelines.lead":
      "Un graphe visuel transforme les lignes qu’un éditeur publie en unités sur lesquelles un réseau raisonne. Chaque étape se prévisualise, et le graphe entier tourne à nouveau quand sa source change.",
    "feat.pipelines.p1.title": "Visible à chaque étape",
    "feat.pipelines.p1.body":
      "Filtrer, joindre, dériver, convertir, déplier, garder le relevé le plus récent. Chaque nœud montre ce qui entre et ce qui sort avant que rien ne soit écrit.",
    "feat.pipelines.p2.title": "Tourne tout seul",
    "feat.pipelines.p2.body":
      "Un pipeline actif tourne à nouveau chaque fois que sa source est mise à jour : le modèle suit un fichier horaire sans que personne n’appuie sur un bouton.",
    "feat.pipelines.p3.title": "Refuse d’échouer en silence",
    "feat.pipelines.p3.body":
      "Une étape qui ne convertirait rien, ne nommerait aucune colonne ou n’écrirait rien est refusée, et un passage qui retirerait la plupart de ce qui existe s’arrête et dit pourquoi.",
    "feat.ontology.title": "Un seul modèle de ce que le réseau possède.",
    "feat.ontology.lead":
      "Des types d’objets, leurs propriétés et les liens entre eux, déclarés dans le vocabulaire de votre institution. Rien dans le moteur ne sait ce qu’est un lit.",
    "feat.ontology.p1.title": "Votre vocabulaire",
    "feat.ontology.p1.body":
      "Un site, une unité, une civière, une station de qualité de l’air : les types sont les vôtres. La plateforme lit ce que chacun déclare au lieu de se fier aux noms.",
    "feat.ontology.p2.title": "Mesuré ou supposé, au dossier",
    "feat.ontology.p2.body":
      "Une propriété peut dire d’où vient sa valeur, quand elle a été observée et de quoi elle parle — et l’écran l’affiche à côté du chiffre.",
    "feat.ontology.p3.title": "Terminologies cliniques",
    "feat.ontology.p3.body":
      "Des concepts SNOMED CT traduits vers la CIM-10, la CIM-O et CTV3 en HTTP, pour des données qui arrivent codées différemment d’une source à l’autre.",
    "feat.twin.title": "Le réseau, en direct, sur une seule carte.",
    "feat.twin.lead":
      "Des sites, des unités et des capteurs placés sur une carte. Chaque chiffre porte son âge et sa provenance.",
    "feat.twin.p1.title": "Des lectures en direct",
    "feat.twin.p1.body":
      "L’occupation, la qualité de l’air et les signaux d’eaux usées se rafraîchissent au rythme de leurs sources, et chaque lecture affiche son âge.",
    "feat.twin.p2.title": "Des alertes sur vos seuils",
    "feat.twin.p2.body":
      "Les règles que vos équipes fixent lèvent une alerte quand une mesure franchit son seuil, et la ferment quand la mesure revient.",
    "feat.twin.p3.title": "Absent n’est pas calme",
    "feat.twin.p3.body":
      "Un site sans lecture est dessiné comme n’en ayant pas, pas comme allant bien. Une limite approximative le dit, sur la carte.",
    "feat.dashboards.title": "Des graphiques proposés d’après le contenu des colonnes.",
    "feat.dashboards.lead":
      "Des tableaux de bord sur vos jeux de données, le jumeau en direct et les simulations. La plateforme lit chaque colonne et ne propose que les graphiques que ses valeurs permettent.",
    "feat.dashboards.p1.title": "Le bon graphique, ou une raison",
    "feat.dashboards.p1.body":
      "Une date stockée en texte est tracée comme du temps, et un numéro de permis n’est jamais additionné. Une colonne qui ne se trace pas dit pourquoi au lieu de produire n’importe quoi.",
    "feat.dashboards.p2.title": "Toujours à jour",
    "feat.dashboards.p2.body":
      "Une carte ne stocke aucune valeur. Ses chiffres sont lus à l’ouverture de la page : une synchronisation horaire atteint le tableau de bord sans que personne n’y touche.",
    "feat.dashboards.p3.title": "Le jumeau et ses simulations",
    "feat.dashboards.p3.body":
      "Les cartes géographiques montrent le réseau en direct, dans un scénario ou figé à une étape d’une simulation. Les séries posent une trajectoire simulée à côté de celle observée.",
    "feat.responses.title": "Comparer une réponse avant de la choisir.",
    "feat.responses.lead":
      "Lancez un évènement — une vague épidémique, une poussée, une fermeture — sur le réseau modélisé, essayez des réponses, et voyez ce que chacune coûte.",
    "feat.responses.p1.title": "Scénarios et épidémies",
    "feat.responses.p1.body":
      "Rejouez une vague observée sur le réseau d’aujourd’hui, ou semez une épidémie dans un territoire et regardez-la gagner les autres.",
    "feat.responses.p2.title": "Classées par dominance",
    "feat.responses.p2.body":
      "Les réponses sont comparées sur les vies, l’attente et le coût. Une option pire sur tous les axes est nommée dominée, et aucun taux de change entre un décès et un dollar n’est inventé.",
    "feat.responses.p3.title": "Déterministe",
    "feat.responses.p3.body":
      "Les mêmes entrées donnent le même résultat : se demander ce qu’agir au jour 42 aurait changé, c’est relancer, pas deviner.",

  },
} as const;

export type DictKey = keyof (typeof dict)["en"];
