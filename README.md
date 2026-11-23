# 长虹居

居京朝暮，共住一程

基于现有页面的北京短期实习合租原型。Django 提供房源查询、注册登录、收藏和室友偏好保存。当前数据集包含 168 套北京主城区模拟房源和 364 位模拟室友。

## 本地启动

在项目目录中运行。需要 Python 3.10 或以上。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py import_listings
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

打开 [长虹居](http://127.0.0.1:8000/)。游客可以查询房源和临时试用室友匹配。注册后，登录同一个账号可以读取已收藏的房源和已保存的偏好。

默认使用项目目录里的 `db.sqlite3`。`import_listings` 默认读取 `beijing-central-shared-rent-synthetic.csv`，也可以传入同格式的 CSV 路径。同编号重新导入会更新该房源和室友，已有收藏会保留。

管理房源时，先运行 `.venv/bin/python manage.py createsuperuser`，再登录 [管理后台](http://127.0.0.1:8000/admin/)。

双击 `index.html` 可用内置数据离线演示，第一版保存在 `第一版（原始）index.html`。登录、共享收藏和偏好保存请通过 Django 打开的页面使用。

## 团队共享数据库

团队成员用浏览器访问同一个 Django 服务。部署 Django 的机器创建或接入一个 PostgreSQL 数据库后，在服务进程中设置以下变量，使用数据库提供的连接参数。

```sh
export PGDATABASE='intern_home'
export PGHOST='数据库主机'
export PGPORT='5432'
export PGUSER='数据库用户'
export PGPASSWORD='数据库密码'
export PGSSLMODE='require'
.venv/bin/python manage.py migrate
.venv/bin/python manage.py import_listings
```

切换数据库后，迁移和导入会在 PostgreSQL 中创建结构和模拟房源。本地 SQLite 的测试账号、偏好和收藏不会自动迁移。对外发布请通过 HTTPS 运行 `intern_home.wsgi:application`，并配置 `DJANGO_DEBUG=0`、`DJANGO_SECRET_KEY` 和逗号分隔的 `DJANGO_ALLOWED_HOSTS`。运行 `.venv/bin/python manage.py collectstatic --noinput` 后，由服务器提供 `staticfiles/` 下的静态文件。

## 高德通勤

申请高德「Web 服务」类型的 Key。在启动 Django 的终端或部署平台中设置 `AMAP_WEB_KEY`，然后重启服务。Key 由后端读取。

配置成功后，搜索结果可为当前通勤方式下的前 6 套房源查询高德路线时间。公共交通路线优先地铁并可能含公交，打车页采用驾车路线时间。筛选范围和通勤费用仍按距离估算。没有 Key 或高德未返回路线时，页面显示距离估算。

[高德路径规划文档](https://lbs.amap.com/api/webservice/guide/api/newroute)
