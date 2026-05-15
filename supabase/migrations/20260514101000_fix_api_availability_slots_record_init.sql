-- =============================================================================
-- Fix api_get_availability_slots: avoid unassigned RECORD access
-- =============================================================================

CREATE OR REPLACE FUNCTION public.api_get_availability_slots(
  p_workspace_id uuid,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT CURRENT_DATE,
  p_service_id uuid DEFAULT NULL,
  p_service_name text DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_staff_name text DEFAULT NULL,
  p_slot_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_profile_user_id uuid;
  v_profile_slug text;
  v_profile_business_name text;

  v_service_id uuid;
  v_service_name text;
  v_service_duration integer;
  v_service_slot_step integer;
  v_service_requires_staff boolean;

  v_resolved_staff_id uuid;
  v_resolved_staff_name text;

  v_exception_is_closed boolean;
  v_exception_start time;
  v_exception_end time;

  v_staff_candidate RECORD;
  v_window RECORD;
  v_day date;
  v_dow integer;
  v_from date := COALESCE(p_from, CURRENT_DATE);
  v_to date := COALESCE(p_to, COALESCE(p_from, CURRENT_DATE));
  v_now timestamp := now() at time zone 'UTC';
  v_slot_start timestamp;
  v_slot_end timestamp;
  v_latest_start timestamp;
  v_cursor timestamp;
  v_has_staff_specific boolean;
  v_has_conflict_block boolean;
  v_conflict_appointments integer;
  v_duration_minutes integer := 30;
  v_slot_step_minutes integer := 30;
  v_min_notice_minutes integer := 0;
  v_max_days_ahead integer := 60;
  v_allow_weekends boolean := true;
  v_requires_staff boolean := true;
  v_has_service_staff_mapping boolean := false;
  v_slots jsonb := '[]'::jsonb;
  v_blocking_appointments integer := 0;
  v_requested_service_name text := NULLIF(btrim(COALESCE(p_service_name, '')), '');
  v_requested_staff_name text := NULLIF(btrim(COALESCE(p_staff_name, '')), '');
  v_uuid_zero constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  SELECT p.id, p.user_id, p.slug, p.business_name,
         COALESCE(p.min_notice_minutes, 0),
         COALESCE(p.max_days_ahead, 60),
         COALESCE(p.allow_weekends, true)
  INTO v_profile_id, v_profile_user_id, v_profile_slug, v_profile_business_name,
       v_min_notice_minutes, v_max_days_ahead, v_allow_weekends
  FROM public.profiles p
  WHERE p.id = p_workspace_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Workspace no encontrado';
  END IF;

  IF v_to < v_from THEN
    v_day := v_from;
    v_from := v_to;
    v_to := v_day;
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT s.id, s.name, s.duration, s.slot_step_minutes, s.requires_staff
    INTO v_service_id, v_service_name, v_service_duration, v_service_slot_step, v_service_requires_staff
    FROM public.services s
    WHERE s.id = p_service_id
      AND s.user_id = v_profile_user_id
      AND COALESCE(s.active, true) = true
      AND COALESCE(s.bookable_online, true) = true
    LIMIT 1;
  ELSIF v_requested_service_name IS NOT NULL THEN
    SELECT s.id, s.name, s.duration, s.slot_step_minutes, s.requires_staff
    INTO v_service_id, v_service_name, v_service_duration, v_service_slot_step, v_service_requires_staff
    FROM public.services s
    WHERE s.user_id = v_profile_user_id
      AND COALESCE(s.active, true) = true
      AND COALESCE(s.bookable_online, true) = true
      AND (
        lower(btrim(s.name)) = lower(v_requested_service_name)
        OR s.name ILIKE '%' || v_requested_service_name || '%'
      )
    ORDER BY
      CASE WHEN lower(btrim(s.name)) = lower(v_requested_service_name) THEN 0 ELSE 1 END,
      s.name
    LIMIT 1;
  END IF;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Servicio no encontrado para este workspace';
  END IF;

  v_duration_minutes := GREATEST(COALESCE(v_service_duration, 30), 5);
  v_slot_step_minutes := GREATEST(
    COALESCE(NULLIF(p_slot_minutes, 0), NULLIF(v_service_slot_step, 0), 30),
    5
  );
  v_requires_staff := COALESCE(v_service_requires_staff, true);

  SELECT EXISTS (
    SELECT 1
    FROM public.staff_services ss
    JOIN public.staff_members st ON st.id = ss.staff_id
    WHERE ss.service_id = v_service_id
      AND st.user_id = v_profile_user_id
      AND COALESCE(st.active, true) = true
  ) INTO v_has_service_staff_mapping;

  IF p_staff_id IS NOT NULL THEN
    SELECT st.id, st.name
    INTO v_resolved_staff_id, v_resolved_staff_name
    FROM public.staff_members st
    WHERE st.id = p_staff_id
      AND st.user_id = v_profile_user_id
      AND COALESCE(st.active, true) = true
    LIMIT 1;
  ELSIF v_requested_staff_name IS NOT NULL THEN
    SELECT st.id, st.name
    INTO v_resolved_staff_id, v_resolved_staff_name
    FROM public.staff_members st
    WHERE st.user_id = v_profile_user_id
      AND COALESCE(st.active, true) = true
      AND (
        lower(btrim(st.name)) = lower(v_requested_staff_name)
        OR st.name ILIKE '%' || v_requested_staff_name || '%'
      )
    ORDER BY
      CASE WHEN lower(btrim(st.name)) = lower(v_requested_staff_name) THEN 0 ELSE 1 END,
      st.name
    LIMIT 1;
  END IF;

  IF (p_staff_id IS NOT NULL OR v_requested_staff_name IS NOT NULL) AND v_resolved_staff_id IS NULL THEN
    RAISE EXCEPTION 'Profesional no encontrado para este workspace';
  END IF;

  IF v_resolved_staff_id IS NOT NULL AND v_has_service_staff_mapping THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.staff_services ss
      WHERE ss.service_id = v_service_id
        AND ss.staff_id = v_resolved_staff_id
    ) THEN
      RAISE EXCEPTION 'El profesional no ofrece este servicio';
    END IF;
  END IF;

  FOR v_day IN
    SELECT gs::date
    FROM generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') gs
    ORDER BY gs
  LOOP
    v_dow := EXTRACT(DOW FROM v_day)::integer;

    IF NOT v_allow_weekends AND v_dow IN (0, 6) THEN
      CONTINUE;
    END IF;

    IF (v_day - CURRENT_DATE) > v_max_days_ahead THEN
      CONTINUE;
    END IF;

    v_exception_is_closed := NULL;
    v_exception_start := NULL;
    v_exception_end := NULL;

    SELECT ae.is_closed, ae.start_time, ae.end_time
    INTO v_exception_is_closed, v_exception_start, v_exception_end
    FROM public.availability_exceptions ae
    WHERE ae.business_id = p_workspace_id
      AND ae.exception_date = v_day
    LIMIT 1;

    IF COALESCE(v_exception_is_closed, false) = true THEN
      CONTINUE;
    END IF;

    FOR v_staff_candidate IN
      SELECT c.staff_id, c.staff_name
      FROM (
        SELECT st.id AS staff_id, st.name AS staff_name
        FROM public.staff_members st
        WHERE st.user_id = v_profile_user_id
          AND COALESCE(st.active, true) = true
          AND (v_resolved_staff_id IS NULL OR st.id = v_resolved_staff_id)
          AND (
            NOT v_requires_staff
            OR NOT v_has_service_staff_mapping
            OR EXISTS (
              SELECT 1
              FROM public.staff_services ss
              WHERE ss.service_id = v_service_id
                AND ss.staff_id = st.id
            )
          )

        UNION ALL

        SELECT NULL::uuid AS staff_id, NULL::text AS staff_name
        WHERE v_requires_staff = false AND v_resolved_staff_id IS NULL
      ) c
    LOOP
      IF v_staff_candidate.staff_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.availability a
          WHERE a.user_id = v_profile_user_id
            AND a.day_of_week = v_dow
            AND a.staff_id = v_staff_candidate.staff_id
            AND COALESCE((to_jsonb(a) ->> 'is_active')::boolean, (to_jsonb(a) ->> 'is_available')::boolean, true) = true
        ) INTO v_has_staff_specific;
      ELSE
        v_has_staff_specific := false;
      END IF;

      FOR v_window IN
        SELECT q.start_time, q.end_time
        FROM (
          SELECT v_exception_start AS start_time, v_exception_end AS end_time
          WHERE COALESCE(v_exception_is_closed, false) = false
            AND v_exception_start IS NOT NULL
            AND v_exception_end IS NOT NULL

          UNION ALL

          SELECT a.start_time, a.end_time
          FROM public.availability a
          WHERE a.user_id = v_profile_user_id
            AND a.day_of_week = v_dow
            AND COALESCE((to_jsonb(a) ->> 'is_active')::boolean, (to_jsonb(a) ->> 'is_available')::boolean, true) = true
            AND (
              (v_staff_candidate.staff_id IS NULL AND a.staff_id IS NULL)
              OR (
                v_staff_candidate.staff_id IS NOT NULL
                AND (
                  (v_has_staff_specific = true AND a.staff_id = v_staff_candidate.staff_id)
                  OR (v_has_staff_specific = false AND a.staff_id IS NULL)
                )
              )
            )
            AND NOT (
              COALESCE(v_exception_is_closed, false) = false
              AND v_exception_start IS NOT NULL
              AND v_exception_end IS NOT NULL
            )
        ) q
        WHERE q.start_time IS NOT NULL
          AND q.end_time IS NOT NULL
          AND q.end_time > q.start_time
        ORDER BY q.start_time
      LOOP
        v_cursor := (v_day + v_window.start_time);
        v_latest_start := (v_day + v_window.end_time) - make_interval(mins => v_duration_minutes);

        WHILE v_cursor <= v_latest_start LOOP
          v_slot_start := v_cursor;
          v_slot_end := v_cursor + make_interval(mins => v_duration_minutes);

          IF v_slot_start < (v_now + make_interval(mins => v_min_notice_minutes)) THEN
            v_cursor := v_cursor + make_interval(mins => v_slot_step_minutes);
            CONTINUE;
          END IF;

          SELECT COUNT(*)
          INTO v_conflict_appointments
          FROM public.appointments ap
          WHERE ap.user_id = v_profile_user_id
            AND ap.date = v_day
            AND ap.status IN ('pending', 'confirmed')
            AND COALESCE(ap.staff_id, v_uuid_zero) = COALESCE(v_staff_candidate.staff_id, v_uuid_zero)
            AND tsrange((ap.date + ap.start_time), (ap.date + ap.end_time), '[)')
                && tsrange(v_slot_start, v_slot_end, '[)');

          IF v_conflict_appointments > 0 THEN
            v_blocking_appointments := v_blocking_appointments + v_conflict_appointments;
            v_cursor := v_cursor + make_interval(mins => v_slot_step_minutes);
            CONTINUE;
          END IF;

          SELECT EXISTS (
            SELECT 1
            FROM public.calendar_blocks cb
            WHERE cb.business_id = v_profile_user_id
              AND cb.type IN ('blocked', 'closed')
              AND tsrange(cb.start_time, cb.end_time, '[)')
                  && tsrange(v_slot_start, v_slot_end, '[)')
          ) INTO v_has_conflict_block;

          IF v_has_conflict_block THEN
            v_cursor := v_cursor + make_interval(mins => v_slot_step_minutes);
            CONTINUE;
          END IF;

          v_slots := v_slots || jsonb_build_array(
            jsonb_build_object(
              'start', to_char(v_slot_start, 'YYYY-MM-DD"T"HH24:MI:SS'),
              'end', to_char(v_slot_end, 'YYYY-MM-DD"T"HH24:MI:SS'),
              'staff_id', v_staff_candidate.staff_id,
              'staff_name', COALESCE(v_staff_candidate.staff_name, '')
            )
          );

          v_cursor := v_cursor + make_interval(mins => v_slot_step_minutes);
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'slots', COALESCE(v_slots, '[]'::jsonb),
    'resolved_service', jsonb_build_object(
      'id', v_service_id,
      'name', v_service_name
    ),
    'resolved_staff', CASE
      WHEN v_resolved_staff_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_resolved_staff_id,
        'name', v_resolved_staff_name
      )
    END,
    'duration_minutes', v_duration_minutes,
    'slot_step_minutes', v_slot_step_minutes,
    'blocking_appointments', v_blocking_appointments,
    'range', jsonb_build_object('from', v_from, 'to', v_to)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.api_get_availability_slots(uuid, date, date, uuid, text, uuid, text, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
