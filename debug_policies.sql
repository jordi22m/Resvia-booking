-- Verificar políticas actuales en profiles
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'profiles';

-- Verificar si hay políticas conflictivas
SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'profiles' AND cmd = 'SELECT';