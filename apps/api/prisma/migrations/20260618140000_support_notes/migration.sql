-- CreateTable
CREATE TABLE "support_notes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_notes_userId_idx" ON "support_notes"("userId");

-- AddForeignKey
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
