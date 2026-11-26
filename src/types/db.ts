
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "cycle_days": {
                  Row: {
                    "date": string,"day_label": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "date": string,"day_label": string,"updated_at"?: string
                  }
                  Update: {
                    "date"?: string,"day_label"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"events": {
                  Row: {
                    "account_key": string,"calendar_status": string,"cancelled_at": string | null,"day_cycle": string | null,"description": string,"end_time": string,"google_event_id": string,"id": string,"is_all_day": boolean,"last_synced_at": string,"location": string,"recurrence_note": string | null,"relevance": string,"series_id": string | null,"source_calendar": string | null,"start_time": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_key": string,"calendar_status"?: string,"cancelled_at"?: string | null,"day_cycle"?: string | null,"description"?: string,"end_time": string,"google_event_id": string,"id": string,"is_all_day"?: boolean,"last_synced_at"?: string,"location"?: string,"recurrence_note"?: string | null,"relevance"?: string,"series_id"?: string | null,"source_calendar"?: string | null,"start_time": string,"title"?: string
                  }
                  Update: {
                    "account_key"?: string,"calendar_status"?: string,"cancelled_at"?: string | null,"day_cycle"?: string | null,"description"?: string,"end_time"?: string,"google_event_id"?: string,"id"?: string,"is_all_day"?: boolean,"last_synced_at"?: string,"location"?: string,"recurrence_note"?: string | null,"relevance"?: string,"series_id"?: string | null,"source_calendar"?: string | null,"start_time"?: string,"title"?: string
                  }
                  Relationships: [
                    
                  ]
                },"system_meta": {
                  Row: {
                    "detail": Json | null,"key": string,"last_run_at": string,"message": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "detail"?: Json | null,"key": string,"last_run_at"?: string,"message"?: string | null,"status"?: string
                  }
                  Update: {
                    "detail"?: Json | null,"key"?: string,"last_run_at"?: string,"message"?: string | null,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tags": {
                  Row: {
                    "created_at": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tasks": {
                  Row: {
                    "category": string,"completed_at": string | null,"created_at": string,"deleted_at": string | null,"due_date": string | null,"id": string,"notes": string,"pinned": boolean,"priority": string,"source": string,"source_ref": string | null,"status": string,"tags": (string)[],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"completed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"due_date"?: string | null,"id"?: string,"notes"?: string,"pinned"?: boolean,"priority"?: string,"source"?: string,"source_ref"?: string | null,"status"?: string,"tags"?: (string)[],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "category"?: string,"completed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"due_date"?: string | null,"id"?: string,"notes"?: string,"pinned"?: boolean,"priority"?: string,"source"?: string,"source_ref"?: string | null,"status"?: string,"tags"?: (string)[],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "is_owner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
