import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export const runtime = "nodejs";

type LeadInteractionSummary = { lead_id: string; created_at: string };

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch leads — paged (see lib/supabase-fetch-all.ts) rather than a plain
  // .select(), which silently caps at 1000 rows once this user has that many.
  const { data: leads, error } = await fetchAllRows((from, to) =>
    supabase
      .from("leads")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );

  if (error) {
    console.error("GET Leads error:", error);
    return NextResponse.json({ error: "Database error: " + error }, { status: 500 });
  }

  // Fetch all interactions for these leads to compute last_interaction_at
  const leadIds = leads.map(l => l.id);
  let allInteractions: LeadInteractionSummary[] = [];

  if (leadIds.length > 0) {
    const { data: interData } = await supabase
      .from("lead_interactions")
      .select("lead_id, created_at")
      .in("lead_id", leadIds);
    if (interData) allInteractions = interData;
  }

  // Process the data to include `last_interaction_at`
  const processedLeads = (leads || []).map(lead => {
    let lastInteraction = lead.created_at; // Fallback to creation date
    
    // Find interactions for this lead
    const leadInteractions = allInteractions.filter(i => i.lead_id === lead.id);
    
    if (leadInteractions.length > 0) {
      // Find the most recent interaction
      const sortedInteractions = [...leadInteractions].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      lastInteraction = sortedInteractions[0].created_at;
    }
    
    return {
      ...lead,
      last_interaction_at: lastInteraction,
    };
  });

  return NextResponse.json({ leads: processedLeads });
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { company_name, contact_name, email, phone, score, staff_name, lead_type, stage } = body;

    if (!company_name) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    const { data: newLead, error } = await supabase
      .from("leads")
      .insert({
        user_id: user.id,
        company_name,
        contact_name: contact_name || null,
        email: email || null,
        phone: phone || null,
        score: score || 'Warm',
        stage: stage || (lead_type === 'Regular Recruiter' ? 'Relationship Mgt' : 'Awareness'),
        staff_name: staff_name || 'Unassigned',
        lead_type: lead_type || 'New Lead',
        jd_count: 0
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ lead: newLead });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create lead";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
