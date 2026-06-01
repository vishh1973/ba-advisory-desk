do $migration$
declare
  v_signature regprocedure := 'public.save_client_workspace_profile_v2(text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if v_definition is null then
    raise exception 'save_client_workspace_profile_v2 was not found.';
  end if;

  if position('#variable_conflict use_column' in v_definition) > 0 then
    return;
  end if;

  v_updated := replace(
    v_definition,
    '$function$' || chr(10) || 'declare',
    '$function$' || chr(10) || '#variable_conflict use_column' || chr(10) || 'declare'
  );

  if v_updated = v_definition then
    v_updated := replace(
      v_definition,
      '$$' || chr(10) || 'declare',
      '$$' || chr(10) || '#variable_conflict use_column' || chr(10) || 'declare'
    );
  end if;

  if position('#variable_conflict use_column' in v_updated) = 0 then
    raise exception 'Could not patch variable conflict directive into save_client_workspace_profile_v2.';
  end if;

  execute v_updated;
end;
$migration$;
