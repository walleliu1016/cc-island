const { Client } = require('pg');

// 从 cloud-server/.env 配置
const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'ccisland',
  user: 'ccisland',
  password: 'password'
});

async function cleanPopups() {
  try {
    await client.connect();

    // 查看现有 popups
    const countResult = await client.query('SELECT COUNT(*) FROM popups');
    console.log(`Found ${countResult.rows[0].count} popups before cleanup`);

    // 查看详细 popups
    const detailResult = await client.query('SELECT id, session_id, popup_type, status, created_at FROM popups ORDER BY created_at DESC LIMIT 10');
    console.log('\nRecent popups:');
    detailResult.rows.forEach(row => {
      console.log(`  ${row.id} | session: ${row.session_id} | type: ${row.popup_type} | status: ${row.status} | ${row.created_at}`);
    });

    // 清理所有 popups
    const deleteResult = await client.query('DELETE FROM popups');
    console.log(`\n✅ Deleted ${deleteResult.rowCount} popups`);

    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

cleanPopups();