export type Locale = "en" | "fr";
export const LOCALES: Locale[] = ["en"];
export const DEFAULT_LOCALE: Locale = "en";

export const dict = {
  en: {
    "nav.docs": "Docs",
    "nav.pricing": "Pricing",
    "nav.signin": "Sign in",
    "nav.getKey": "Get API key",
    "nav.toggleMenu": "Toggle menu",

    "beta.label": "Test phase only",
    "beta.message":
      "No uptime or accuracy SLA. Responses may be wrong, slow, or change without notice — not for clinical decisions.",
    "beta.unstableApisIntro":
      "These endpoints are more likely to show bugs or rough edges during the test period:",
    "beta.unstableApisDetails": "Affected endpoints",

    "hero.pill.beta": "Beta",
    "hero.pill.body":
      "· Test phase — feedback welcome at obscyro-team@obscyro.com",
    "hero.title": "Health data, finally fluent.",
    "hero.subtitle":
      "One API for SNOMED, ICD-10, RxNorm, LOINC, FHIR, and HL7. Stop translating. Start building.",
    "hero.cta.getKey": "Get API key",
    "hero.cta.docs": "Read the docs",
    "hero.stat.concepts": "Concepts",
    "hero.stat.mappings": "Mappings",
    "hero.stat.latency": "p95 latency",
    "hero.responseLabel": "↓ response",

    "problem.eyebrow": "The interop tax",
    "problem.title": "Healthcare data doesn't speak one language.",
    "problem.pain1.title": "Different systems, same data, different codes",
    "problem.pain1.body":
      "Hospitals use SNOMED. Insurers use ICD-10. Labs use LOINC. Pharmacies use RxNorm. Every integration becomes a translation problem.",
    "problem.pain2.title": "Manual mapping costs $300K+ per integration",
    "problem.pain2.body":
      "Hand-curated cross-walks burn six-figure budgets and months of clinical-informaticist time before a single record flows.",
    "problem.pain3.title": "Built once, breaks at every standards update",
    "problem.pain3.body":
      "Yearly SNOMED, ICD-10, and FHIR releases ship breaking changes. Static mappings rot the moment you stop maintaining them.",
    "problem.diagramEyebrow": "Obscyro in one diagram",
    "problem.node.in": "Raw clinical input",
    "problem.node.api": "Obscyro API",
    "problem.node.out": "Normalized output",

    "features.eyebrow": "What you can do",
    "features.title": "Six primitives. Endless integrations.",
    "features.subtitle":
      "Compose them like Lego to fix the interoperability layer of your product, all in pure HTTP.",
    "features.validate.title": "Validate",
    "features.validate.desc": "Verify any medical code in milliseconds.",
    "features.normalize.title": "Normalize",
    "features.normalize.desc": "Turn raw clinical text into standard codes.",
    "features.translate.title": "Translate",
    "features.translate.desc": "SNOMED ↔ ICD-10 ↔ RxNorm ↔ LOINC.",
    "features.expand.title": "Expand",
    "features.expand.desc": "Navigate clinical hierarchies semantically.",
    "features.disambiguate.title": "Disambiguate",
    "features.disambiguate.desc": "Pick the right code with context.",
    "features.reason.title": "Reason",
    "features.reason.desc": "Detect logical contradictions in clinical data.",
    "features.showExample": "Show example",
    "features.hideExample": "Hide example",

    "pricing.eyebrow": "Pricing",
    "pricing.title": "Simple, predictable, healthcare-friendly.",
    "pricing.subtitle":
      "No per-record fees. No hidden integration costs. Pay for the calls you make.",
    "pricing.popular": "Most popular",
    "pricing.free.name": "Free",
    "pricing.free.price": "$0",
    "pricing.free.period": "forever",
    "pricing.free.desc": "Build prototypes and explore the API surface.",
    "pricing.free.f1": "1,000 calls / month",
    "pricing.free.f2": "100 req/min rate limit",
    "pricing.free.f3": "All endpoints unlocked",
    "pricing.free.f4": "Community support",
    "pricing.free.cta": "Start free",
    "pricing.starter.name": "Starter",
    "pricing.starter.price": "$99",
    "pricing.starter.period": "/month",
    "pricing.starter.desc": "Ship to your first production users.",
    "pricing.starter.f1": "100,000 calls / month",
    "pricing.starter.f2": "1,000 req/min rate limit",
    "pricing.starter.f3": "Email support",
    "pricing.starter.f4": "Usage analytics dashboard",
    "pricing.starter.cta": "Get Starter",
    "pricing.pro.name": "Pro",
    "pricing.pro.price": "$499",
    "pricing.pro.period": "/month",
    "pricing.pro.desc": "Scale with confidence and SLAs.",
    "pricing.pro.f1": "1,000,000 calls / month",
    "pricing.pro.f2": "10,000 req/min rate limit",
    "pricing.pro.f3": "99.9% uptime SLA",
    "pricing.pro.f4": "Slack-channel support",
    "pricing.pro.cta": "Get Pro",
    "pricing.enterprise":
      "Need higher volume, dedicated tenancy, or BAA?",
    "pricing.enterpriseCta":
      "Enterprise: custom pricing — contact us",

    "finalCta.title": "Start building in minutes.",
    "finalCta.subtitle":
      "Mint your API key, copy a curl, ship coded data the same afternoon.",
    "finalCta.cta": "Get your API key",

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
      "The semantic interoperability layer for healthcare data. SNOMED, ICD-10, RxNorm, LOINC, FHIR, and HL7 — one API.",

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
      "I understand Obscyro is in beta and endpoints, schemas, and pricing may change without notice.",
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
      "Paste the API key you saved from your sign-up. We never stored it on our servers.",
    "signin.label": "Your API key",
    "signin.placeholder": "obs_live_…",
    "signin.submit": "Continue",
    "signin.submitting": "Verifying…",
    "signin.invalid": "Invalid or revoked key. Double-check the value.",
    "signin.noAccount": "No account?",
    "signin.signupHere": "Sign up free",

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
    "app.keys.regenerateSoon": "Self-serve key regeneration coming soon. Email us to rotate.",
    "app.keys.plan": "Plan",
    "app.keys.upgrade": "Upgrade soon.",
    "app.keys.usage": "Usage this month",
    "app.keys.usageLimit": "of 1,000 calls",
    "app.comingSoon.title": "Coming soon",
    "app.usage.body":
      "Per-endpoint usage breakdowns, daily charts, and quota alerts will live here.",
    "app.billing.body":
      "Plan upgrades, invoices, and payment methods will live here once we leave beta.",
    "app.settings.body":
      "Profile, team members, and webhook configuration will live here.",
    "app.guard.signinRequired":
      "Sign in to access the console.",
    "app.menu": "Dashboard menu",
    "app.openMenu": "Open dashboard menu",
    "app.closeMenu": "Close menu",

    "app.overview.eyebrow": "Console",
    "app.overview.title": "Overview",
    "app.overview.subtitle":
      "Quick links and reminders while Obscyro is in public test. Production polish comes later.",
    "app.overview.card.keys.title": "API keys",
    "app.overview.card.keys.desc": "View, copy, and protect your bearer token.",
    "app.overview.card.usage.title": "Usage",
    "app.overview.card.usage.desc": "Monthly quota and usage trends (more soon).",
    "app.overview.card.docs.title": "Documentation",
    "app.overview.card.docs.desc": "HTTP examples, parameters, and response shapes.",
    "app.overview.quickStart.eyebrow": "Quick start",
    "app.overview.quickStart.line1":
      "Send header Authorization: Bearer <your-api-key> on every request.",
    "app.overview.quickStart.line2":
      "Use your deployment base URL in production, or http://localhost:3000 (or your dev port) locally.",

    "docs.menu": "Documentation menu",
    "docs.openMenu": "Open documentation menu",
    "docs.closeMenu": "Close menu",
  },
  fr: {
    "nav.docs": "Docs",
    "nav.pricing": "Tarifs",
    "nav.signin": "Connexion",
    "nav.getKey": "Obtenir une clé",
    "nav.toggleMenu": "Ouvrir le menu",

    "beta.label": "Phase de test uniquement",
    "beta.message":
      "Aucun SLA de disponibilité ni de justesse. Les réponses peuvent être incorrectes, lentes ou changer sans préavis — pas pour des décisions cliniques.",
    "beta.unstableApisIntro":
      "Ces endpoints sont les plus susceptibles de bugs ou de comportements perfectibles pendant la test :",
    "beta.unstableApisDetails": "Endpoints concernés",

    "hero.pill.beta": "Beta",
    "hero.pill.body":
      "· Phase de test — vos retours sont bienvenus à obscyro-team@obscyro.com",
    "hero.title": "Les données de santé, enfin parlantes.",
    "hero.subtitle":
      "Une seule API pour SNOMED, ICD-10, RxNorm, LOINC, FHIR et HL7. Arrêtez de traduire. Construisez.",
    "hero.cta.getKey": "Obtenir une clé",
    "hero.cta.docs": "Lire la doc",
    "hero.stat.concepts": "Concepts",
    "hero.stat.mappings": "Correspondances",
    "hero.stat.latency": "Latence p95",
    "hero.responseLabel": "↓ réponse",

    "problem.eyebrow": "La taxe d'interopérabilité",
    "problem.title": "Les données de santé ne parlent pas une seule langue.",
    "problem.pain1.title": "Mêmes données, codes différents selon les systèmes",
    "problem.pain1.body":
      "Les hôpitaux utilisent SNOMED. Les assureurs ICD-10. Les labos LOINC. Les pharmacies RxNorm. Chaque intégration devient un problème de traduction.",
    "problem.pain2.title": "Le mapping manuel coûte 300 000 $+ par intégration",
    "problem.pain2.body":
      "Les correspondances faites à la main brûlent six chiffres de budget et des mois de temps d'informaticiens cliniques avant qu'un seul dossier ne circule.",
    "problem.pain3.title": "Codé une fois, cassé à chaque mise à jour",
    "problem.pain3.body":
      "Les versions annuelles de SNOMED, ICD-10 et FHIR introduisent des changements cassants. Les mappings statiques pourrissent dès que vous arrêtez de les maintenir.",
    "problem.diagramEyebrow": "Obscyro en un schéma",
    "problem.node.in": "Entrée clinique brute",
    "problem.node.api": "API Obscyro",
    "problem.node.out": "Sortie normalisée",

    "features.eyebrow": "Ce que vous pouvez faire",
    "features.title": "Six primitives. Des intégrations infinies.",
    "features.subtitle":
      "Composez-les comme du Lego pour réparer la couche d'interopérabilité de votre produit, en pur HTTP.",
    "features.validate.title": "Valider",
    "features.validate.desc": "Vérifiez n'importe quel code médical en millisecondes.",
    "features.normalize.title": "Normaliser",
    "features.normalize.desc": "Transformez du texte clinique brut en codes standards.",
    "features.translate.title": "Traduire",
    "features.translate.desc": "SNOMED ↔ ICD-10 ↔ RxNorm ↔ LOINC.",
    "features.expand.title": "Étendre",
    "features.expand.desc": "Naviguez les hiérarchies cliniques sémantiquement.",
    "features.disambiguate.title": "Désambiguïser",
    "features.disambiguate.desc": "Choisissez le bon code avec le contexte.",
    "features.reason.title": "Raisonner",
    "features.reason.desc": "Détectez les contradictions logiques dans les données cliniques.",
    "features.showExample": "Voir l'exemple",
    "features.hideExample": "Masquer l'exemple",

    "pricing.eyebrow": "Tarifs",
    "pricing.title": "Simple, prévisible, pensé pour la santé.",
    "pricing.subtitle":
      "Pas de frais à l'enregistrement. Pas de coûts d'intégration cachés. Vous payez les appels que vous faites.",
    "pricing.popular": "Le plus populaire",
    "pricing.free.name": "Free",
    "pricing.free.price": "0 $",
    "pricing.free.period": "à vie",
    "pricing.free.desc": "Pour prototyper et explorer l'API.",
    "pricing.free.f1": "1 000 appels / mois",
    "pricing.free.f2": "100 req/min de rate limit",
    "pricing.free.f3": "Tous les endpoints débloqués",
    "pricing.free.f4": "Support communautaire",
    "pricing.free.cta": "Démarrer gratuitement",
    "pricing.starter.name": "Starter",
    "pricing.starter.price": "99 $",
    "pricing.starter.period": "/mois",
    "pricing.starter.desc": "Pour vos premiers utilisateurs en production.",
    "pricing.starter.f1": "100 000 appels / mois",
    "pricing.starter.f2": "1 000 req/min de rate limit",
    "pricing.starter.f3": "Support par email",
    "pricing.starter.f4": "Tableau de bord d'usage",
    "pricing.starter.cta": "Choisir Starter",
    "pricing.pro.name": "Pro",
    "pricing.pro.price": "499 $",
    "pricing.pro.period": "/mois",
    "pricing.pro.desc": "Pour passer à l'échelle avec SLA.",
    "pricing.pro.f1": "1 000 000 appels / mois",
    "pricing.pro.f2": "10 000 req/min de rate limit",
    "pricing.pro.f3": "SLA 99,9 % de disponibilité",
    "pricing.pro.f4": "Support sur canal Slack",
    "pricing.pro.cta": "Choisir Pro",
    "pricing.enterprise":
      "Besoin de plus de volume, d'une infra dédiée ou d'un BAA ?",
    "pricing.enterpriseCta":
      "Enterprise : tarif sur mesure — contactez-nous",

    "finalCta.title": "Commencez à coder en quelques minutes.",
    "finalCta.subtitle":
      "Générez votre clé API, copiez un curl, livrez des données codées le jour même.",
    "finalCta.cta": "Obtenir ma clé API",

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
      "La couche d'interopérabilité sémantique pour les données de santé. SNOMED, ICD-10, RxNorm, LOINC, FHIR et HL7 — une seule API.",

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
      "Je comprends qu'Obscyro est en beta et que les endpoints, schémas et tarifs peuvent changer sans préavis.",
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
      "Collez la clé API que vous avez sauvegardée à l'inscription. Nous ne l'avons jamais stockée.",
    "signin.label": "Votre clé API",
    "signin.placeholder": "obs_live_…",
    "signin.submit": "Continuer",
    "signin.submitting": "Vérification…",
    "signin.invalid": "Clé invalide ou révoquée. Vérifiez la valeur.",
    "signin.noAccount": "Pas de compte ?",
    "signin.signupHere": "Inscrivez-vous gratuitement",

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
    "app.keys.regenerateSoon":
      "La régénération en libre-service arrive bientôt. Écrivez-nous pour rotation.",
    "app.keys.plan": "Plan",
    "app.keys.upgrade": "Mise à niveau bientôt.",
    "app.keys.usage": "Usage ce mois-ci",
    "app.keys.usageLimit": "sur 1 000 appels",
    "app.comingSoon.title": "Bientôt disponible",
    "app.usage.body":
      "Les détails d'usage par endpoint, graphiques quotidiens et alertes de quota apparaîtront ici.",
    "app.billing.body":
      "Les changements de plan, factures et moyens de paiement apparaîtront ici à la sortie de beta.",
    "app.settings.body":
      "Profil, membres d'équipe et configuration des webhooks apparaîtront ici.",
    "app.guard.signinRequired":
      "Connectez-vous pour accéder à la console.",
    "app.menu": "Menu du tableau de bord",
    "app.openMenu": "Ouvrir le menu du tableau de bord",
    "app.closeMenu": "Fermer le menu",

    "app.overview.eyebrow": "Console",
    "app.overview.title": "Vue d'ensemble",
    "app.overview.subtitle":
      "Raccourcis et rappels pendant la phase de test publique. Le reste arrive plus tard.",
    "app.overview.card.keys.title": "Clés API",
    "app.overview.card.keys.desc": "Consulter, copier et protéger votre jeton bearer.",
    "app.overview.card.usage.title": "Usage",
    "app.overview.card.usage.desc": "Quota mensuel et tendances (bientôt plus de détail).",
    "app.overview.card.docs.title": "Documentation",
    "app.overview.card.docs.desc": "Exemples HTTP, paramètres et formes de réponse.",
    "app.overview.quickStart.eyebrow": "Démarrage rapide",
    "app.overview.quickStart.line1":
      "En-tête obligatoire : Authorization: Bearer <votre-clé-api> sur chaque requête.",
    "app.overview.quickStart.line2":
      "Utilisez l'URL de base de votre déploiement en production, ou http://localhost:3000 (ou votre port de dev) en local.",

    "docs.menu": "Menu de documentation",
    "docs.openMenu": "Ouvrir le menu de documentation",
    "docs.closeMenu": "Fermer le menu",
  },
} as const;

export type DictKey = keyof (typeof dict)["en"];
