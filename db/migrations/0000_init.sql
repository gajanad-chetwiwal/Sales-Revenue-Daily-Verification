CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"currency" text NOT NULL,
	"shopify_domain" text,
	"square_location_id" text,
	"square_env" text,
	"token_encrypted" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"store_id" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_status" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"platform_id" text NOT NULL,
	"order_number" text,
	"created_at" timestamp with time zone NOT NULL,
	"report_date" date NOT NULL,
	"currency" text NOT NULL,
	"gross_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discounts" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"shipping" numeric(12, 2) DEFAULT '0' NOT NULL,
	"fees" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refunds" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"financial_status" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_store_id_platform_id_key" ON "transactions" USING btree ("store_id","platform_id");--> statement-breakpoint
CREATE INDEX "idx_tx_report_date" ON "transactions" USING btree ("report_date","store_id");