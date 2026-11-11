-- CreateIndex
CREATE INDEX "CampaignRecipient_userId_idx" ON "CampaignRecipient"("userId");

-- CreateIndex
CREATE INDEX "Cart_userId_idx" ON "Cart"("userId");

-- CreateIndex
CREATE INDEX "CrmActivity_dealId_idx" ON "CrmActivity"("dealId");

-- CreateIndex
CREATE INDEX "CrmTask_dealId_idx" ON "CrmTask"("dealId");

-- CreateIndex
CREATE INDEX "CustomerGroupMember_companyId_idx" ON "CustomerGroupMember"("companyId");

-- CreateIndex
CREATE INDEX "Deal_companyId_idx" ON "Deal"("companyId");

-- CreateIndex
CREATE INDEX "Delivery_routeId_idx" ON "Delivery"("routeId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_deliveryId_idx" ON "DeliveryAttempt"("deliveryId");

-- CreateIndex
CREATE INDEX "Invoice_originalInvoiceId_idx" ON "Invoice"("originalInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceTaxSummary_invoiceId_idx" ON "InvoiceTaxSummary"("invoiceId");

-- CreateIndex
CREATE INDEX "MembershipRole_roleId_idx" ON "MembershipRole"("roleId");

-- CreateIndex
CREATE INDEX "MembershipScope_membershipId_idx" ON "MembershipScope"("membershipId");

-- CreateIndex
CREATE INDEX "Order_parentOrderId_idx" ON "Order"("parentOrderId");

-- CreateIndex
CREATE INDEX "Order_placedByUserId_idx" ON "Order"("placedByUserId");

-- CreateIndex
CREATE INDEX "OrderException_orderId_idx" ON "OrderException"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLineDiscount_orderLineId_idx" ON "OrderLineDiscount"("orderLineId");

-- CreateIndex
CREATE INDEX "PackagingUnit_variantId_idx" ON "PackagingUnit"("variantId");

-- CreateIndex
CREATE INDEX "Payment_companyId_idx" ON "Payment"("companyId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_vendorInvoiceId_idx" ON "PaymentAllocation"("vendorInvoiceId");

-- CreateIndex
CREATE INDEX "PriceListItem_offerId_idx" ON "PriceListItem"("offerId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "PromotionRedemption_orderId_idx" ON "PromotionRedemption"("orderId");

-- CreateIndex
CREATE INDEX "PromotionTarget_promotionId_idx" ON "PromotionTarget"("promotionId");

-- CreateIndex
CREATE INDEX "ReturnLine_returnId_idx" ON "ReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- CreateIndex
CREATE INDEX "RouteStop_deliveryId_idx" ON "RouteStop"("deliveryId");

-- CreateIndex
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");

-- CreateIndex
CREATE INDEX "SupportTicket_orderId_idx" ON "SupportTicket"("orderId");

-- CreateIndex
CREATE INDEX "VendorBillingStatement_vendorCompanyId_idx" ON "VendorBillingStatement"("vendorCompanyId");

-- CreateIndex
CREATE INDEX "VendorBillingStatement_orderId_idx" ON "VendorBillingStatement"("orderId");

-- CreateIndex
CREATE INDEX "VendorBillingStatement_salesInvoiceId_idx" ON "VendorBillingStatement"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "VendorInvoiceAllocation_statementId_idx" ON "VendorInvoiceAllocation"("statementId");

-- CreateIndex
CREATE INDEX "VendorServiceArea_vendorCompanyId_idx" ON "VendorServiceArea"("vendorCompanyId");

