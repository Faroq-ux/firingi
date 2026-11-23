-- CreateTable
CREATE TABLE "AiWorkflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "match" TEXT NOT NULL DEFAULT 'ALL',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "maxRunsPerDay" INTEGER NOT NULL DEFAULT 50,
    "cursorAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "template" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "companyId" TEXT,
    "link" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB NOT NULL DEFAULT '[]',
    "resumeAt" TIMESTAMP(3),
    "error" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Bot',
    "tone" TEXT NOT NULL DEFAULT 'tone-blue',
    "tools" TEXT[],
    "dataAreas" TEXT[],
    "autonomy" TEXT NOT NULL DEFAULT 'APPROVAL',
    "model" TEXT,
    "effort" TEXT NOT NULL DEFAULT 'medium',
    "maxRunsPerDay" INTEGER NOT NULL DEFAULT 24,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "schedule" JSONB,
    "scheduleTask" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "template" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "output" TEXT,
    "tools" JSONB,
    "model" TEXT,
    "byClaude" BOOLEAN NOT NULL DEFAULT true,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "proposals" INTEGER NOT NULL DEFAULT 0,
    "rating" INTEGER,
    "ratedById" TEXT,
    "error" TEXT,
    "runById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiApproval" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "agentId" TEXT,
    "agentRunId" TEXT,
    "workflowId" TEXT,
    "workflowRunId" TEXT,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "detail" JSONB NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'admin.ai.approve',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "result" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiWorkflow_active_trigger_idx" ON "AiWorkflow"("active", "trigger");

-- CreateIndex
CREATE INDEX "AiWorkflow_active_nextRunAt_idx" ON "AiWorkflow"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "AiWorkflowRun_status_resumeAt_idx" ON "AiWorkflowRun"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "AiWorkflowRun_startedAt_idx" ON "AiWorkflowRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiWorkflowRun_workflowId_subjectKey_key" ON "AiWorkflowRun"("workflowId", "subjectKey");

-- CreateIndex
CREATE INDEX "AiAgent_active_nextRunAt_idx" ON "AiAgent"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "AiAgentRun_agentId_startedAt_idx" ON "AiAgentRun"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "AiAgentRun_startedAt_idx" ON "AiAgentRun"("startedAt");

-- CreateIndex
CREATE INDEX "AiApproval_status_createdAt_idx" ON "AiApproval"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiApproval_agentId_status_idx" ON "AiApproval"("agentId", "status");

-- AddForeignKey
ALTER TABLE "AiWorkflowRun" ADD CONSTRAINT "AiWorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AiWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgentRun" ADD CONSTRAINT "AiAgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

