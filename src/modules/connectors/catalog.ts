import type { ConnectorCard } from "@/lib/types";

export const connectorCatalog: ConnectorCard[] = [
  {
    key: "generic_webhook",
    name: "Webhook generique",
    description: "Recevez des demandes JSON depuis n'importe quel outil.",
    status: "Connecté",
    health: "healthy",
    capabilities: ["webhook", "mapping contact", "journal livraisons"],
  },
  {
    key: "csv_contacts",
    name: "Import CSV contacts",
    description: "Importez un fichier de contacts et detectez les doublons.",
    status: "Disponible",
    health: "inactive",
    capabilities: ["csv", "validation", "rapport import"],
  },
  {
    key: "mock_business",
    name: "Logiciel metier demo",
    description: "Simule clients, rendez-vous, devis et factures.",
    status: "Configuration requise",
    health: "warning",
    capabilities: ["sync", "clients", "rendez-vous", "devis"],
  },
  {
    key: "google_business_profile",
    name: "Google Business Profile",
    description: "Connexion prevue apres validation OAuth.",
    status: "Bientôt disponible",
    health: "inactive",
    capabilities: ["avis", "profil", "statistiques"],
  },
];
