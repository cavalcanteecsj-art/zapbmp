-- CreateTable Tag
CREATE TABLE "Tag" (
    "name" TEXT NOT NULL,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("name")
);

-- CreateTable GroupTag
CREATE TABLE "GroupTag" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "tagName" TEXT NOT NULL,
    CONSTRAINT "GroupTag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GroupTag_tagName_fkey" FOREIGN KEY ("tagName") REFERENCES "Tag"("name") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupTag_groupId_tagName_key" ON "GroupTag"("groupId", "tagName");

-- CreateIndex
CREATE INDEX "GroupTag_groupId_idx" ON "GroupTag"("groupId");

