export type Role =
  | "owner"
  | "administrator"
  | "manager"
  | "collaborator"
  | "read-only";

export type ConnectorStatus =
  | "Disponible"
  | "Connecté"
  | "Configuration requise"
  | "Erreur"
  | "Bientôt disponible";

export type ApprovalPolicy =
  | "no_approval_required"
  | "user_approval_required"
  | "administrator_approval_required"
  | "prohibited_automatic_execution";

export type User = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  category: string;
  createdAt: string;
};

export type Membership = {
  tenantId: string;
  userId: string;
  role: Role;
};

export type BusinessProfile = {
  identity: {
    companyName: string;
    category: string;
    description: string;
    existingWebsite?: string;
  };
  brand: {
    tone: string;
    colors: string[];
    logoUrl?: string;
    photoUrls: string[];
  };
  services: string[];
  products: string[];
  targetCustomers: string;
  geographicalAreas: string[];
  openingHours: string;
  salesObjectives: string;
  approvedClaims: string[];
  forbiddenClaims: string[];
  faqs: Array<{ question: string; answer: string }>;
  contactMethods: {
    address: string;
    phone: string;
    email: string;
    socialLinks: string[];
  };
  websitePreferences: {
    desiredCallsToAction: string[];
    preferredTemplate: WebsiteTemplateKey;
  };
  automationPreferences: {
    leadFollowUpDelayHours: number;
    notificationChannels: string[];
    approvalPolicy: ApprovalPolicy;
  };
  futureKnowledgeSources: string[];
};

export type WebsiteTemplateKey = "artisan" | "restaurant" | "beauty";

export type WebsiteTheme = {
  primary: string;
  accent: string;
  background: string;
  text: string;
  radius: string;
};

export type WebsiteSectionType =
  | "hero"
  | "introduction"
  | "services"
  | "offers"
  | "benefits"
  | "reviews"
  | "gallery"
  | "faq"
  | "hours"
  | "coverage"
  | "contact"
  | "whatsapp"
  | "appointment"
  | "footer";

export type WebsiteSection = {
  id: string;
  tenantId: string;
  websiteId: string;
  type: WebsiteSectionType;
  position: number;
  enabled: boolean;
  title: string;
  body: string;
  imageUrl?: string;
  buttonLabel?: string;
  buttonHref?: string;
  data: Record<string, unknown>;
};

export type Website = {
  id: string;
  tenantId: string;
  name: string;
  templateKey: WebsiteTemplateKey;
  status: "draft" | "published";
  theme: WebsiteTheme;
  currentVersionId?: string;
  currentPublishedVersionId?: string;
  currentDraftVersionId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export type Contact = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  source: string;
  tags: string[];
  assignedUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Lead = {
  id: string;
  tenantId: string;
  contactId: string;
  source: string;
  status: string;
  opportunityValue: number;
  pagePath: string;
  createdAt: string;
};

export type Activity = {
  id: string;
  tenantId: string;
  type: string;
  summary: string;
  targetType: string;
  targetId: string;
  createdAt: string;
};

export type Task = {
  id: string;
  tenantId: string;
  title: string;
  status: "open" | "done";
  assignedUserId: string;
  dueAt: string;
  relatedType: string;
  relatedId: string;
  createdAt: string;
};

export type WorkflowRun = {
  id: string;
  tenantId: string;
  workflowKey: string;
  triggerName: string;
  status:
    | "running"
    | "succeeded"
    | "failed"
    | "waiting"
    | "approval_required"
    | "cancelled"
    | "rejected";
  summary: string;
  createdAt: string;
  steps: WorkflowRunStep[];
};

export type WorkflowRunStep = {
  id: string;
  actionName: string;
  status: string;
  attempts: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
};

export type WorkflowDeadLetterEvent = {
  id: string;
  tenantId: string;
  eventType: string;
  attempts: number;
  lastError: string;
  lastAttemptedAt: string | null;
  lastRetryDelayMs: number;
  failureClassification: string | null;
  maxAttempts: number | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowQueueStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "skipped";

export type WorkflowQueueSummary = {
  status: WorkflowQueueStatus;
  count: number;
  oldestNextRunAt: string | null;
  latestUpdatedAt: string | null;
};

export type WorkflowQueueEvent = {
  id: string;
  tenantId: string;
  eventType: string;
  status: WorkflowQueueStatus;
  attempts: number;
  nextRunAt: string;
  lastAttemptedAt: string | null;
  lastRetryDelayMs: number;
  failureClassification: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowQueueOverview = {
  summary: WorkflowQueueSummary[];
  activeEvents: WorkflowQueueEvent[];
};

export type ConnectorCard = {
  key: string;
  name: string;
  description: string;
  status: ConnectorStatus;
  capabilities: string[];
  lastSyncAt?: string;
  health: "healthy" | "warning" | "error" | "inactive";
};

export type AuditLog = {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
};

export type OpportunityRadarRuleKey =
  | "lead_sla_missed"
  | "overdue_task"
  | "opportunity_without_activity"
  | "unassigned_contact"
  | "failed_workflow"
  | "connector_error"
  | "unpublished_draft_changes"
  | "failed_form_processing"
  | "likely_duplicate_contact"
  | "api_breaking_change";

export type OpportunityRadarAlert = {
  id: string;
  tenantId: string;
  ruleKey: OpportunityRadarRuleKey;
  severity: "info" | "warning" | "critical";
  title: string;
  explanation: string;
  entityType: string;
  entityId: string;
  detectedAt: string;
  actionLabel: string;
  actionHref: string;
  status: "active" | "dismissed" | "resolved";
  dismissedAt?: string;
  resolvedAt?: string;
};

export type DashboardActionItem = {
  id: string;
  title: string;
  explanation: string;
  actionLabel: string;
  actionHref: string;
  severity: "info" | "warning" | "critical";
};

export type DashboardApiSourceFailure = DashboardActionItem & {
  status: "blocked" | "retrying";
};

export type DashboardPendingApproval = DashboardActionItem & {
  approvalType: "workflow" | "connector" | "strategic";
};

export type DashboardData = {
  tenant: Tenant;
  metrics: {
    newLeads: number;
    contacts: number;
    pendingTasks: number;
    formSubmissions: number;
    overdueTasks: number;
    opportunitiesNeedingFollowUp: number;
    workflowFailures: number;
    deadLetters: number;
    connectorIssues: number;
    apiSourceFailures: number;
    breakingApiChanges: number;
    pendingApprovals: number;
  };
  websiteStatus: string;
  opportunitiesByStage: Array<{ stage: string; count: number }>;
  connectorHealth: ConnectorCard[];
  recentActivities: Activity[];
  workflowRuns: WorkflowRun[];
  detectedOpportunities: OpportunityRadarAlert[];
  commandCenter: {
    capturedAt: string;
    timeZone: string;
    dayStartedAt: string;
    dayEndsAt: string;
    priorityActions: DashboardActionItem[];
    overdueTasks: DashboardActionItem[];
    newLeads: DashboardActionItem[];
    opportunitiesNeedingFollowUp: DashboardActionItem[];
    workflowFailures: DashboardActionItem[];
    deadLetters: DashboardActionItem[];
    apiSourceFailures: DashboardApiSourceFailure[];
    breakingApiChanges: DashboardActionItem[];
    pendingApprovals: DashboardPendingApproval[];
    website: {
      status: "absent" | "draft" | "published";
      label: string;
      hasUnpublishedChanges: boolean;
      publishedAt: string | null;
    };
  };
};
