-- Assistant photos (product, label, order list) and photos on support messages
ALTER TABLE "AiMessage" ADD COLUMN "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TicketMessage" ADD COLUMN "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
