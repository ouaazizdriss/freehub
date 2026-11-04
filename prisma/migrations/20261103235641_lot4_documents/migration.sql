-- AlterTable
ALTER TABLE "FreelancerDocument" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "uploadedById" TEXT;

