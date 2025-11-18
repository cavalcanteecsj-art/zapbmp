-- CreateEnum
CREATE TYPE "Status" AS ENUM ('OPEN', 'OK', 'LATE', 'BREACHED');

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "mentionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterPhone" TEXT,
    "messagePreview" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstReplyAt" TIMESTAMP(3),
    "assignee" TEXT,
    "status" "Status" NOT NULL DEFAULT 'OPEN',
    "targetSeconds" INTEGER NOT NULL DEFAULT 300,
    "tags" JSONB,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mention_mentionId_key" ON "Mention"("mentionId");

-- CreateIndex
CREATE INDEX "Mention_createdAt_status_idx" ON "Mention"("createdAt", "status");

-- CreateIndex
CREATE INDEX "Mention_groupId_idx" ON "Mention"("groupId");
